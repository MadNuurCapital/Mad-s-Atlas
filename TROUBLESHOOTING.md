# Troubleshooting — Mad's Atlas

Symptom → cause → fix.

Start with the health check and the job status view; between them they explain
most problems.

```
https://<site>/api/health          liveness and dependency reachability
Settings → System                  last run of every scheduled job
/history                           what Atlas actually did
```

---

## Authentication

### "This application is private."

**Working as intended** if you signed in with anything other than
`ATLAS_OWNER_EMAIL`.

If it happens to the *owner* account:

```sql
select email, enabled from private.allowed_users;
```

- No row → run `npx tsx scripts/seed-owner.ts`
- `enabled = false` → `update private.allowed_users set enabled = true where email = '...';`
- Email mismatch → compare against `ATLAS_OWNER_EMAIL` exactly, including case
  and any dots or plus-aliases

### A non-owner account CAN sign in

**This is a security failure. Fix it before anything else.**

The Before User Created hook is not enabled or is not wired correctly.
Dashboard → Authentication → Hooks → Before User Created must be enabled and
point at `private.check_user_allowed`. See
[SUPABASE_SETUP.md](./SUPABASE_SETUP.md) § 10.

Delete the unauthorised user immediately:
```sql
select id, email from auth.users where email <> '<owner email>';
-- then delete via the dashboard, which cascades correctly
```

### Signed in but redirected to `/sign-in` in a loop

Cookies are not being set or read. Check:
- `NEXT_PUBLIC_APP_URL` matches the actual origin exactly
- Supabase → Authentication → URL Configuration lists the site URL
- You are on HTTPS in production (secure cookies require it)
- Third-party cookie blocking is not interfering (Safari is strictest)

### `redirect_uri_mismatch`

The redirect URI sent does not exactly match one registered on the Google OAuth
client. Compare character by character — a trailing slash or `http` vs `https`
is enough to break it. All of these must agree: `NEXT_PUBLIC_APP_URL`, the
Google authorised redirect URIs, and the Supabase URL configuration.

---

## Google integration

### Google access stops working roughly every 7 days

**The most likely single problem in this system.** The OAuth app is still in
**Testing** status, where Google expires refresh tokens after 7 days.

Fix: Google Cloud Console → OAuth consent screen → **Publish app** → status
becomes *In production*. Then reconnect Google once to obtain a fresh,
non-expiring refresh token. Full explanation in
[GOOGLE_OAUTH_SETUP.md](./GOOGLE_OAUTH_SETUP.md) § Testing vs Production.

### "Reconnect Google" banner will not go away

```sql
select connection_status, last_error, last_refreshed_at, access_token_expires_at
from public.connected_accounts;
```

| `connection_status` | Meaning | Fix |
|---|---|---|
| `needs_reconnection` | Refresh failed | Reconnect via Settings |
| `revoked` | Access revoked at Google | Reconnect; check myaccount.google.com/permissions |
| `error` | Something else — read `last_error` | Depends |

### No refresh token was stored

```sql
select encrypted_refresh_token is not null as has_refresh
from public.connected_accounts;
```

If false, the sign-in did not request offline access. Confirm
`access_type: 'offline'` and `prompt: 'consent'` are in the OAuth options, then
revoke at <https://myaccount.google.com/permissions> and consent again — Google
only issues a refresh token on a fresh grant.

### `insufficient_permission` from Gmail or Calendar

The scope was not actually granted. Consent can return fewer scopes than
requested:

```sql
select granted_scopes from public.connected_accounts;
```

Reconnect with `prompt=consent` and make sure every checkbox is ticked on the
consent screen.

### Calendar shows the wrong times

Almost always a timezone conversion, not a Google problem. Confirm:
- `profiles.timezone` is `Asia/Singapore`
- Timestamps are stored as UTC
- Conversion happens at display time only
- **No DST logic is being applied to Singapore** — it is a fixed UTC+08:00

---

## Voice

### `401` from `/api/gemini/live-token`

Not signed in, or the session email does not match `ATLAS_OWNER_EMAIL`. The
server log records the owner-verification outcome without recording the email.

### `429` from the token endpoint

Rate limit or voice budget reached. Check the usage dashboard. This is a
deliberate control, not a bug — see [PERMISSIONS.md](./PERMISSIONS.md) § Budget
guardrails.

### The WebSocket closes immediately

Ephemeral tokens are single-use with a short new-session expiry. Mint the token
**immediately before** connecting, not at page load. If the user takes a minute
to click "start", the token has already expired.

### "Model not found"

`GEMINI_LIVE_MODEL` names a model that no longer exists. List what is available
through the SDK and update the environment variable — never patch a fallback
model into the code.

```ts
const models = await ai.models.list();
```

### The session drops at about ten minutes

Expected — that is the Live API connection lifetime. Session resumption should
reconnect transparently. If it does not, resumption is not implemented
correctly.

### No sound from Atlas

Browser autoplay policy. Audio playback must start from a user gesture —
initiate it in the same click handler that starts the session.

### The microphone will not turn on

- Permission was denied and cannot be re-prompted programmatically. Show
  instructions for re-enabling it in browser settings.
- The page must be HTTPS (or `localhost`).
- Check the CSP `Permissions-Policy` header includes `microphone=(self)`.

### Voice works locally but not in production

Content-Security-Policy `connect-src` must allow **both**
`https://generativelanguage.googleapis.com` and
`wss://generativelanguage.googleapis.com`. The WebSocket scheme is a separate
entry.

---

## Database

### "new row violates row-level security policy"

The insert is not setting `user_id`, or is setting it to someone else's ID.
Every insert must set `user_id` to `auth.uid()`.

### A query returns nothing, but the rows exist

Almost always RLS working correctly with the wrong client. Check which client is
in use:
- `client.ts` — browser, respects RLS
- `server.ts` — SSR with the user's session, respects RLS
- `admin.ts` — secret key, bypasses RLS, **server modules only**

### `supabase db push` reports drift

The remote schema is ahead of your local migrations. Inspect it:
```bash
supabase db diff --linked
```
Never edit an applied migration. Write a new one that reconciles the difference.

### `create extension "vector"` fails

Enable it in the dashboard first: Database → Extensions → vector.

### Semantic search is slow

The HNSW index is probably missing or unused:
```sql
select indexname, indexdef from pg_indexes
where tablename = 'memories';

explain analyze
select id from public.memories
order by embedding <=> '[...]'::vector limit 10;
```

A sequential scan means the index is not being used. Most common cause: the
vector dimension does not match the column, or the column exceeds pgvector's
2000-dimension index limit. See [MEMORY_SYSTEM.md](./MEMORY_SYSTEM.md).

---

## Approvals

### "approval_not_claimable"

One of four things, and all of them are the system working:

- Already executed — the duplicate-execution guard
- Expired — past `expires_at`
- Not approved — still `pending` or `rejected`
- Idempotency key mismatch — a replay attempt

```sql
select status, expires_at, executed_at from public.approvals where id = '...';
```

### An approval expired before it could be approved

`approval_expiry_minutes` is too short for the workflow. Raise it in Settings —
the range is 5 to 1440 minutes.

### An edited approval executed the old payload

**This would be a serious bug.** Editing must create a new approval with
`supersedes_approval_id` set and reject the original. If it ever happens, check
that `payload_hash` is verified immediately before the external call.

---

## Scheduled jobs

### No daily briefing appeared

Work down this list:

```sql
-- 1. Did the job run at all?
select * from private.job_runs
where job_name = 'daily_briefing' order by started_at desc limit 5;

-- 2. Is the cron entry active?
select jobname, schedule, active from cron.job;

-- 3. Did the HTTP call succeed?
select status, return_message, start_time from cron.job_run_details
order by start_time desc limit 10;
```

| Finding | Cause |
|---|---|
| No `job_runs` row | Cron did not fire, or `pg_net` failed |
| Row with `status = 'failed'` | Read `error_code`; check function logs |
| Row with `status = 'skipped'` | Briefings disabled in settings |
| Cron inactive | `select cron.alter_job(..., active := true);` |

```bash
supabase functions logs daily-briefing --tail
```

### Two briefings for the same day

Should be impossible — there are two independent guards. If it happens, verify
`unique (user_id, briefing_date, timezone)` exists on `daily_briefings`, and
that the job claims `private.job_runs` before doing any work.

### A reminder fired twice

The `run_key` must include the trigger time
(`reminder:<id>:<next_trigger_at>`), otherwise a recurring reminder claims the
same key on every occurrence — or worse, fires repeatedly within one occurrence.

### Edge Function returns 500 with no detail

```bash
supabase functions logs <name> --tail
```

Then re-trigger. Nearly always a missing secret:
```bash
supabase secrets list
```
Compare against [SUPABASE_SETUP.md](./SUPABASE_SETUP.md) § 12.

---

## Build and deploy

### "Invalid environment variables"

The Zod env schema is doing its job. The error names the missing or malformed
variable and deliberately never prints its value. Compare the Netlify variable
list against `.env.example`.

### Build succeeds, production 500s

A server-only variable is set locally but missing on Netlify. `/api/health` will
usually indicate which dependency is unreachable.

### A `NEXT_PUBLIC_` change had no effect

Those values are compiled in at build time. Change it, then **redeploy** — a
restart is not enough.

### `import 'server-only'` build error

Something in a client component is importing a server module — usually
`src/lib/supabase/admin.ts`. This error is a feature: it caught a potential
secret leak at build time. Move the logic to a route handler or server
component.

---

## Research

### A research answer has no sources

Grounding returned nothing. Atlas must say so rather than answering from model
knowledge. If it answered confidently without sources, that is a bug in the
research path — a time-sensitive question must never be answered from built-in
knowledge alone.

### Sources look plausible but are wrong

Check that URLs come from grounding metadata rather than from generated text.
Citations are never constructed by the model.

---

## Cost

### Usage is higher than expected

`/history` and the usage dashboard show where it went. Common causes:

- Tool-loop depth too generous — the model searching repeatedly
- Voice sessions not ending cleanly, so they run to the maximum
- Research called several times per request
- Embedding backfill reprocessing the same failing rows

All have configured limits. See [PERMISSIONS.md](./PERMISSIONS.md) § Budget
guardrails.

### "I've hit today's limit"

Working as intended. Limits are configurable, but raise them deliberately rather
than reflexively.

---

## Still stuck

1. `/api/health` — what is unreachable?
2. Settings → System — which job last failed?
3. `/history` — what did Atlas actually do?
4. Supabase → Logs — database and auth errors
5. `supabase functions logs <name> --tail` — scheduled job errors
6. Netlify → Deploys → the build log
7. Browser DevTools console and network

The system is built to fail loudly with an internal error code. Search the
codebase for that code — it leads to the exact throw site.
