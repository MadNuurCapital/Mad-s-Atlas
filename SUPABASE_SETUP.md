# Supabase Setup — Mad's Atlas

Written assuming no prior Supabase CLI experience. Every command is given in
full. Run them in order.

---

## Complete setup checklist

The full path from nothing to a working deployment. Steps 1–5 and 10 are here;
the others link out.

- [ ] 1. Create the Supabase project — *below*
- [ ] 2. Install the Supabase CLI — *below*
- [ ] 3. Link the local repository — *below*
- [ ] 4. Apply migrations — *below*
- [ ] 5. Enable required extensions — *below*
- [ ] 6. Configure Google OAuth in Supabase — [GOOGLE_OAUTH_SETUP.md](./GOOGLE_OAUTH_SETUP.md)
- [ ] 7. Configure the Google Cloud consent screen — [GOOGLE_OAUTH_SETUP.md](./GOOGLE_OAUTH_SETUP.md)
- [ ] 8. Add authorised redirect URLs — [GOOGLE_OAUTH_SETUP.md](./GOOGLE_OAUTH_SETUP.md)
- [ ] 9. Seed `ATLAS_OWNER_EMAIL` — *below*
- [ ] 10. Enable the Before User Created hook — *below*
- [ ] 11. Configure Netlify environment variables — [NETLIFY_DEPLOYMENT.md](./NETLIFY_DEPLOYMENT.md)
- [ ] 12. Configure Edge Function secrets — *below*
- [ ] 13. Deploy Edge Functions — *below*
- [ ] 14. Create cron jobs — [SCHEDULED_JOBS.md](./SCHEDULED_JOBS.md)
- [ ] 15. Configure the Gemini API key — [GEMINI_LIVE_SETUP.md](./GEMINI_LIVE_SETUP.md)
- [ ] 16. Deploy to Netlify — [NETLIFY_DEPLOYMENT.md](./NETLIFY_DEPLOYMENT.md)
- [ ] 17. Test Google reconnection — [NETLIFY_DEPLOYMENT.md](./NETLIFY_DEPLOYMENT.md)
- [ ] 18. Test Gemini voice — [GEMINI_LIVE_SETUP.md](./GEMINI_LIVE_SETUP.md)
- [ ] 19. Test RLS — [TESTING.md](./TESTING.md)
- [ ] 20. Test approvals and complete data deletion — [TESTING.md](./TESTING.md)

---

## 1. Create the project

1. Go to <https://supabase.com/dashboard> and sign in.
2. **New project**.
3. Fill in:
   - **Name:** `mads-atlas`
   - **Database password:** generate a strong one and **save it in your password
     manager now**. You cannot retrieve it later, and you need it for
     `SUPABASE_DB_URL`.
   - **Region:** `Southeast Asia (Singapore)` — lowest latency for Muhammad and
     keeps data in-region.
   - **Plan:** Free is sufficient for a single user.
4. Wait for provisioning (about two minutes).

### Collect the values you need

**Project Settings → Data API**
- Project URL → `NEXT_PUBLIC_SUPABASE_URL`
- The reference in that URL (`https://<ref>.supabase.co`) is your
  **project ref** — you need it for `supabase link`.

**Project Settings → API Keys**
- Publishable key (`sb_publishable_…`) → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- Create a secret key (`sb_secret_…`) → `SUPABASE_SECRET_KEY`

> Use the new publishable/secret keys, not the legacy `anon` and `service_role`
> keys. The legacy keys are deprecated at the end of 2026.

**Project Settings → Database → Connection string → URI**
- → `SUPABASE_DB_URL`, replacing `[YOUR-PASSWORD]` with the password you saved.

⚠ The secret key bypasses Row Level Security completely. It belongs in server
environments only — never `NEXT_PUBLIC_`, never in the browser, never in git.

---

## 2. Install the CLI

**macOS**
```bash
brew install supabase/tap/supabase
```

**Windows (PowerShell)**
```powershell
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase
```

**Any platform, via npx** — no global install:
```bash
npx supabase --version
```
If you use `npx`, prefix every `supabase` command below with `npx`.

Verify:
```bash
supabase --version
```

---

## 3. Link the repository

Authenticate — this opens a browser:
```bash
supabase login
```

Link this directory to your project, using the ref from step 1:
```bash
cd /path/to/Mad-s-Atlas
supabase link --project-ref <your-project-ref>
```

You will be prompted for the database password. This writes
`supabase/.temp/` (git-ignored) and confirms the link.

Check it worked:
```bash
supabase projects list
```
Your project should show `●` in the LINKED column.

---

## 4. Apply migrations

Migrations live in `supabase/migrations/` and run in filename order.

**Review before applying** — always read what is about to run against a real
database:
```bash
supabase db diff --linked
```

**Apply:**
```bash
supabase db push
```

**Verify:**
```bash
supabase db diff --linked
# No differences means the remote matches your migrations.
```

### Local development (optional but recommended)

Run the whole stack locally in Docker so you can test migrations destructively:

```bash
supabase start     # first run pulls images; takes a few minutes
supabase status    # prints local URL and keys
supabase db reset  # wipe and re-apply every migration + seed.sql
supabase stop
```

`db reset` is the fastest way to prove your migrations are genuinely idempotent
and complete.

---

## 5. Enable extensions

Migration `0001_extensions.sql` handles this, but if you need to do it by hand —
**SQL Editor → New query**:

```sql
create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "vector";     -- pgvector: semantic memory
create extension if not exists "pg_cron";    -- scheduled jobs
create extension if not exists "pg_net";     -- cron → Edge Function calls
create extension if not exists "citext";     -- case-insensitive email
```

Confirm:
```sql
select extname, extversion from pg_extension order by extname;
```

Then hide the `private` schema from the API:
**Project Settings → Data API → Exposed schemas** — ensure it lists `public`
only. `private` must **not** appear.

---

## 9. Seed the owner

This is what makes the application yours and nobody else's.

Set `ATLAS_OWNER_EMAIL` and `SUPABASE_SECRET_KEY` in `.env.local`, then:

```bash
npx tsx scripts/seed-owner.ts
```

Expected output:
```
✓ Owner allowlist updated: m****@gmail.com (enabled)
```

The script is idempotent — running it again is harmless. It never prints the
secret key and never prints the full email address.

Verify in the SQL Editor:
```sql
select email, enabled, created_at from private.allowed_users;
```

---

## 10. Enable the Before User Created hook

This rejects every signup that is not on the allowlist, before a user row is
created.

1. **Dashboard → Authentication → Hooks**
2. **Before User Created** → Enable
3. Type: **Postgres function**
4. Function: `private.check_user_allowed`
5. Save.

The function ships in the Phase 2 migrations:

```sql
create or replace function private.check_user_allowed(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  v_email := lower(trim(event -> 'user_metadata' ->> 'email'));
  if v_email is null then
    v_email := lower(trim(event -> 'claims' ->> 'email'));
  end if;

  if not exists (
    select 1 from private.allowed_users
     where email = v_email and enabled = true
  ) then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'This application is private.'
      )
    );
  end if;

  return '{}'::jsonb;
end;
$$;

grant execute on function private.check_user_allowed to supabase_auth_admin;
revoke execute on function private.check_user_allowed from authenticated, anon, public;
```

**Test it.** Try to sign in with any other Google account. You should be
rejected with "This application is private." If a second account can create a
user, stop and fix it before going further — this is the primary access control.

---

## 12. Edge Function secrets

Scheduled jobs run outside Netlify and need their own copies of the secrets:

```bash
supabase secrets set \
  GEMINI_API_KEY="..." \
  GEMINI_TEXT_MODEL="gemini-3.6-flash" \
  GEMINI_EMBEDDING_MODEL="gemini-embedding-001" \
  TOKEN_ENCRYPTION_KEY="..." \
  GOOGLE_CLIENT_ID="..." \
  GOOGLE_CLIENT_SECRET="..." \
  ATLAS_OWNER_EMAIL="..." \
  ATLAS_TIMEZONE="Asia/Singapore" \
  VAPID_PUBLIC_KEY="..." \
  VAPID_PRIVATE_KEY="..." \
  VAPID_SUBJECT="mailto:..."
```

`SUPABASE_URL` and the service key are injected automatically into Edge
Functions — do not set them yourself.

List what is set (names only, never values):
```bash
supabase secrets list
```

---

## 13. Deploy Edge Functions

```bash
supabase functions deploy daily-briefing
supabase functions deploy check-reminders
supabase functions deploy meeting-preparation
supabase functions deploy generate-embeddings
supabase functions deploy maintenance
```

Or all at once:
```bash
supabase functions deploy
```

Verify:
```bash
supabase functions list
```

Watch a function's logs live while you test it:
```bash
supabase functions logs daily-briefing --tail
```

---

## Type generation

Run after **every** schema change. Committed to the repo so CI type-checks
against real types:

```bash
npm run db:types
# → supabase gen types typescript --linked > src/types/database.ts
```

---

## Command reference

| Task | Command |
|---|---|
| Log in | `supabase login` |
| Link project | `supabase link --project-ref <ref>` |
| Apply migrations | `supabase db push` |
| Check for drift | `supabase db diff --linked` |
| New migration file | `supabase migration new <name>` |
| Local stack up / down | `supabase start` / `supabase stop` |
| Reset local database | `supabase db reset` |
| Generate types | `supabase gen types typescript --linked` |
| Deploy functions | `supabase functions deploy` |
| Tail function logs | `supabase functions logs <name> --tail` |
| Set secrets | `supabase secrets set KEY="value"` |
| List secrets | `supabase secrets list` |

---

## Common problems

**`supabase link` fails with "invalid project ref"**
The ref is the subdomain of your project URL — from
`https://abcdefghijklmnop.supabase.co`, the ref is `abcdefghijklmnop`.

**`db push` says "migration already applied"**
The remote is ahead of your local files. Run `supabase db diff --linked` to see
what differs. Never edit an applied migration — add a new one.

**`create extension "vector"` fails**
Enable it in the dashboard first: **Database → Extensions → vector**.

**Signup succeeds for a non-owner email**
The hook is not enabled or is not wired to `private.check_user_allowed`. Recheck
step 10. This is a security failure — stop and fix it before deploying.

**Edge Function returns 500 with no detail**
`supabase functions logs <name> --tail`, then re-trigger. Almost always a
missing secret from step 12.

More in [TROUBLESHOOTING.md](./TROUBLESHOOTING.md).
