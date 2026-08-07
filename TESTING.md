# Testing — Mad's Atlas

Vitest for unit and integration tests. Playwright for end-to-end.

The tests worth writing here are the ones that prove a **security or correctness
invariant**, not the ones that raise a coverage percentage. A test that asserts
an approval cannot execute twice is worth more than fifty tests asserting a
component renders.

---

## Commands

```bash
npm run test              # unit
npm run test:watch        # unit, watching
npm run test:integration  # integration — needs the local database harness
npm run test:e2e          # end-to-end — builds and serves the app
npm run test:e2e:ui       # Playwright UI mode
npm run lint
npm run typecheck
npm run build
npm run verify            # lint + typecheck + unit + build
```

## The local database harness

Integration tests run against a **real PostgreSQL cluster**, not a mock. This
is what turns "RLS protects the data" from a claim into a tested property.

```bash
bash scripts/local-db.sh start    # create cluster, apply all migrations
bash scripts/local-db.sh reset    # destroy and rebuild from scratch
bash scripts/local-db.sh psql     # open a shell
bash scripts/local-db.sh stop
```

It needs `postgresql-16` and `postgresql-16-pgvector`. The script installs
neither — it fails with the exact `apt-get` line if they are missing.

`tests/fixtures/supabase-shim.sql` supplies the pieces Supabase manages: the
`auth` schema, `auth.uid()`, the four roles, and stand-ins for `pg_net` and
`pg_cron` that record what *would* have been called. It is a test fixture, is
never deployed, and is never imported by application code.

Integration tests **skip** rather than fail when the harness is absent, so
`npm run verify` stays useful without a database. CI must run them with it up.

### Two ways to write a useless RLS test

Both produce a suite that passes no matter how broken the policies are, and
both were hit while building this:

1. **`SET LOCAL` outside a transaction is a silent no-op.** The role never
   changes, every statement runs as the superuser, and superusers bypass RLS.
2. **Forgetting `set role authenticated`.** Same outcome by a different route.

`tests/helpers/db.ts` does both correctly — use `asUser()` and `asAnon()`
rather than issuing statements directly.

Every phase must pass all of these before it is considered complete.

---

## Layout

```
tests/
  unit/          pure logic, no network, no database
  integration/   real Supabase, real schema, real RLS
  e2e/           real browser, real app
  fixtures/      shared test data
  helpers/       auth helpers, test users, cleanup
```

---

## Unit tests

Fast, isolated, no external calls.

### Permission decisions
- Every Level 1 tool resolves to Level 1
- Every Level 2 tool resolves to Level 2
- Level 3 tools are absent from the registry entirely
- An unknown tool name is refused, not defaulted
- Memory sensitivity escalates a save from Level 1 to Level 2
- Budget exhaustion refuses before execution

### Zod schemas
- Valid input passes
- Missing required fields fail
- Wrong types fail rather than coercing
- Extra fields are stripped, not silently accepted
- Boundary values behave (empty string, zero, maximum length)

### Token encryption
- Encrypt then decrypt returns the original
- Each encryption produces a different IV
- A tampered ciphertext fails authentication
- A tampered auth tag fails
- The wrong key fails
- Encrypting an empty string does not silently produce an empty token

### Date and timezone
- UTC → `Asia/Singapore` conversion
- 09:00 SGT is 01:00 UTC
- **No DST is ever applied to Singapore**, including across dates when other
  zones shift
- Natural-language dates: "tomorrow", "next Friday", "in 2 hours"
- Ambiguous phrasing is flagged for confirmation, not guessed
- All-day event boundaries
- Recurrence expansion in the reminder's own timezone

### Memory scoring
- Hybrid score combines the six weighted signals correctly
- Recency decay behaves at the half-life
- Results below the similarity floor are dropped
- Result count never exceeds the cap
- `highly_sensitive` is excluded unless directly relevant
- Suggested memories never appear in answer-informing retrieval

### Tool selection
- Clear intent maps to the expected tool
- Time-sensitive phrasing routes to research, not model knowledge
- Ambiguous intent asks rather than guessing

### Approval expiry and idempotency
- An approval expires exactly at `expires_at`
- Expiry is computed from `approval_expiry_minutes`
- Idempotency keys are unique and stable for the same logical action
- `payload_hash` is stable across key ordering (canonicalised JSON)

### Research validation
- A report with zero sources is not marked verified
- A source URL must be `http`/`https`
- Private, loopback, link-local and metadata addresses are rejected
- A missing publication date is null, never invented

### Email prompt-injection filtering
- Known injection payloads produce no tool call
- Untrusted content never lands in a system-instruction field
- Instructions in an email body do not alter permissions

### Redaction
- Token-shaped strings are stripped from log payloads
- Email bodies are stripped
- Memory content is stripped
- Known secret patterns never reach a log sink

---

## Integration tests

Real Supabase. These need `SUPABASE_DB_URL` and `SUPABASE_SECRET_KEY`, and they
clean up after themselves.

### Auth and owner restriction
- The OAuth callback creates a profile and settings for the owner
- A non-owner signup is rejected by the Before User Created hook
- The owner check rejects a session whose email does not match
- A disabled allowlist row blocks access even with a valid session

### Row Level Security — the critical suite
- Create two users; each writes a row in every table
- Assert neither can **read** the other's rows
- Assert neither can **update** the other's rows
- Assert neither can **delete** the other's rows
- Assert the anonymous role reads nothing anywhere
- **Assert every table in `public` has RLS enabled and at least one policy** —
  this is what catches a new table shipped without policies

### Google tokens
- First consent stores encrypted access and refresh tokens
- **A re-login with no refresh token preserves the existing one** — the single
  most important integration test in the suite
- The database trigger rejects an update that would null a valid refresh token
- Expiry detection triggers a refresh
- Refresh failure sets `needs_reconnection` and records a redacted error
- Client queries cannot select token columns

### Gmail and Calendar
- Search returns results with expected shape
- Thread retrieval works
- Full bodies are not persisted anywhere
- Calendar list returns today's events in the right timezone
- **No code path exists that sends email**

### Approvals
- Creation stores the exact payload and its hash
- `claim_approval` succeeds once
- **A second claim fails** — the double-execution test
- An expired approval cannot be claimed
- A mismatched idempotency key cannot claim
- Editing creates a new approval and rejects the old one
- A mutated payload fails the hash check before any external call

### Memory
- Insert with a null embedding succeeds — the save is never blocked
- Full-text search returns expected rows
- Vector search returns expected rows
- Hybrid search ranks sensibly
- **Vector-search failure falls back to full-text and says so**
- Updating content writes a `memory_versions` row
- Supersede links both rows and keeps both
- Export excludes token columns
- Complete deletion removes everything in the correct order

### Scheduled functions
- `daily_briefing` produces exactly one briefing per date
- **Running it twice produces one briefing** — the duplicate test
- `check_reminders` fires due reminders and advances recurring ones
- `meeting_preparation` never prepares the same event twice
- `generate_embeddings` retries failures with a bound and gives up cleanly
- Every job records a `private.job_runs` row, including on failure

---

## End-to-end tests

The 30 required scenarios. All must pass before V1 is done.

| # | Scenario |
|---|---|
| 1 | Owner signs in successfully |
| 2 | Non-owner signup is rejected |
| 3 | Protected pages reject unauthenticated access |
| 4 | **The permanent Gemini API key never appears in browser traffic** |
| 5 | The Gemini ephemeral token endpoint is owner-protected |
| 6 | A voice session starts |
| 7 | Voice interruption works |
| 8 | Text fallback works |
| 9 | Current research returns real sources |
| 10 | Today's calendar loads |
| 11 | Calendar event creation runs immediately on an authenticated owner request |
| 12 | Gmail search works |
| 13 | Gmail draft creation requires approval |
| 14 | **Email sending is unavailable anywhere in the interface** |
| 15 | Task creation works |
| 16 | Reminder scheduling works |
| 17 | A memory suggestion does not become confirmed automatically |
| 18 | A confirmed memory can be retrieved |
| 19 | A memory can be edited |
| 20 | A memory can be deleted |
| 21 | **An approval cannot execute twice** |
| 22 | **An expired approval cannot execute** |
| 23 | A daily briefing is not duplicated |
| 24 | Data export works |
| 25 | Complete Atlas data deletion works |
| 26 | Mobile Safari interface works |
| 27 | Desktop interface works |
| 28 | The production build succeeds |
| 29 | **No secrets appear in git history** |
| 30 | RLS tests pass |

### Scenario 4 — how it is actually tested

Not by inspection. Playwright intercepts every request and response, plus every
loaded script, and asserts the key value appears in none of them:

```ts
test('permanent Gemini key never reaches the browser', async ({ page }) => {
  const key = process.env.GEMINI_API_KEY!;
  const sightings: string[] = [];

  page.on('request', (r) => {
    if (r.postData()?.includes(key)) sightings.push(`request ${r.url()}`);
  });
  page.on('response', async (r) => {
    const body = await r.text().catch(() => '');
    if (body.includes(key)) sightings.push(`response ${r.url()}`);
  });

  await page.goto('/talk');
  await page.getByRole('button', { name: /start (voice )?session/i }).click();
  await page.waitForTimeout(3000);

  expect(sightings).toEqual([]);
});
```

The same pattern covers `SUPABASE_SECRET_KEY`, `GOOGLE_CLIENT_SECRET` and
`TOKEN_ENCRYPTION_KEY`.

### Scenario 21 — how it is actually tested

Two clicks in the same tick, then assert the external effect happened once:

```ts
test('an approval cannot execute twice', async ({ page }) => {
  await page.goto('/approvals');
  const approve = page.getByRole('button', { name: 'Approve' }).first();
  await Promise.all([approve.click(), approve.click()]);

  await expect(page.getByText('Executed')).toBeVisible();
  // exactly one execution recorded, one draft created
  expect(await countActionLogs('gmail.execute_create_draft')).toBe(1);
});
```

### Scenario 29 — secrets in git history

Not a browser test. `scripts/security-check.ts` scans the full history:

```bash
git log -p --all | grep -nE '(sb_secret_|AIza[0-9A-Za-z_-]{35}|GOCSPX-)'
```

Any hit fails the build. If a secret is found, rotate it — removing it from
history is necessary but not sufficient, because it has already been pushed.

---

## Test data

- Integration tests create their own users and clean up in `afterAll`.
- **Never run integration tests against production data.** Use a separate
  Supabase project, or local `supabase start`.
- Gmail and Calendar are mocked in integration tests; E2E uses a real test
  Google account with a handful of fixture messages and events.
- Gemini is mocked in unit tests, stubbed with recorded responses in integration
  tests, and real in a small number of E2E tests.

---

## CI

On every push:

```
1  npm ci
2  npm run lint
3  npx tsc --noEmit
4  npm run test
5  npm run build
6  npx tsx scripts/security-check.ts
```

Integration and E2E run against a staging Supabase project, not on every push.

---

## Current coverage

| Suite | Count | Runs against |
|---|---|---|
| Unit | 192 | Pure logic, no network |
| Integration | 86 | A real PostgreSQL 16 + pgvector cluster |
| End-to-end | 22 | A real browser, desktop and mobile viewports |

Of the 30 required end-to-end scenarios, those that need only the application
itself are covered. The remainder — anything requiring a live Google account,
a Gemini key or a deployed Supabase project — are written but cannot run until
those credentials exist. `README.md` § What has actually been verified states
the split.

## Writing a test worth having

Ask: **what invariant does this protect?**

Worth writing:
- An approval cannot execute twice
- A refresh token is never overwritten with nothing
- Untrusted content cannot trigger a tool
- One user cannot read another's rows
- The API key never reaches the browser

Not worth writing:
- A component renders without crashing
- A getter returns what the setter set
- A mock was called

The first list describes ways this system could hurt Muhammad. Test those.
