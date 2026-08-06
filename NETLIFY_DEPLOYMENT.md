# Netlify Deployment — Mad's Atlas

Hosting on Netlify Personal using the official Next.js support.

---

## Build configuration

`netlify.toml` at the repository root:

```toml
[build]
  command = "npm run build"

[build.environment]
  NODE_VERSION = "20"

# Netlify's OpenNext adapter handles SSR, route handlers and ISR.
# Do NOT set a `publish` directory when using it.
[[plugins]]
  package = "@netlify/plugin-nextjs"

[[headers]]
  for = "/*"
  [headers.values]
    X-Content-Type-Options = "nosniff"
    X-Frame-Options = "DENY"
    Referrer-Policy = "strict-origin-when-cross-origin"
    Permissions-Policy = "microphone=(self), camera=(), geolocation=(), payment=()"
    Strict-Transport-Security = "max-age=63072000; includeSubDomains; preload"
```

The Content-Security-Policy is set in `next.config.mjs` rather than here, so it
can vary between development and production without editing deployment config.
Full policy in [SECURITY.md](./SECURITY.md) § Headers.

Netlify's adapter supports Next.js 13.5 and above, including Next.js 16, and
updates automatically unless you pin it.

---

## Connect the repository

1. <https://app.netlify.com> → **Add new site → Import an existing project**
2. Connect GitHub, authorise, select `MadNuurCapital/Mad-s-Atlas`
3. Netlify detects Next.js. Confirm:
   - Build command: `npm run build`
   - Publish directory: leave as detected — **do not override it**
4. **Do not deploy yet.** Set the environment variables first, or the build
   fails at env validation (by design — the app refuses to boot
   half-configured).

---

## Environment variables

**Site configuration → Environment variables**. Add every one of these.

### Browser-safe

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_APP_URL` | `https://<your-site>.netlify.app` — no trailing slash |
| `NEXT_PUBLIC_SUPABASE_URL` | From Supabase → Data API |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | From `npx web-push generate-vapid-keys` |

### Server-only ⚠

| Variable | Notes |
|---|---|
| `ATLAS_OWNER_EMAIL` | The only address that can sign in |
| `ATLAS_TIMEZONE` | `Asia/Singapore` |
| `SUPABASE_SECRET_KEY` | `sb_secret_…` — bypasses RLS |
| `SUPABASE_DB_URL` | Postgres connection string |
| `GEMINI_API_KEY` | Never reaches the browser |
| `GEMINI_LIVE_MODEL` | `gemini-3.1-flash-live-preview` |
| `GEMINI_TEXT_MODEL` | `gemini-3.6-flash` |
| `GEMINI_EMBEDDING_MODEL` | `gemini-embedding-001` |
| `GOOGLE_CLIENT_ID` | |
| `GOOGLE_CLIENT_SECRET` | |
| `GOOGLE_REDIRECT_URI` | The Supabase callback URL |
| `TOKEN_ENCRYPTION_KEY` | `openssl rand -base64 32` |
| `VAPID_PRIVATE_KEY` | |
| `VAPID_SUBJECT` | `mailto:you@example.com` |
| `SENTRY_DSN` | Optional; leave unset to disable |

### Two rules

1. **Never prefix a secret with `NEXT_PUBLIC_`.** That prefix compiles the value
   into the browser bundle permanently. There is no undo — only rotation.
2. **Scope matters.** `NEXT_PUBLIC_*` values are baked in at build time, so
   changing one requires a redeploy, not just a restart. Set the "Same value for
   all deploy contexts" option unless you deliberately want previews to differ.

---

## Deploy

**Deploys → Trigger deploy → Deploy site**, or push to the connected branch.

Watch the build log for:
- `✓ Compiled successfully`
- `✓ Generating static pages`
- No warnings about missing environment variables

If the build fails at env validation, the Zod schema is doing its job. The error
names the missing variable and never prints a value.

### Custom domain (optional)

**Domain management → Add a domain**, then update:
- `NEXT_PUBLIC_APP_URL`
- Google OAuth authorised origins and redirect URIs
- Supabase → Authentication → URL Configuration

All three must agree, or sign-in breaks with `redirect_uri_mismatch`.

---

## Post-deploy verification

Work through these in order. Each depends on the previous one.

### Basic reachability

- [ ] `https://<site>/api/health` returns `200` with a status body
- [ ] The health response reveals **no** secrets, versions or configuration
- [ ] `/` redirects an unauthenticated visitor to `/sign-in`
- [ ] Every protected route redirects when signed out

### Authentication

- [ ] Sign in as the owner → succeeds, lands on `/today`
- [ ] Sign in with a different Google account → rejected, "This application is
      private."
- [ ] Sign out clears the session; the back button does not restore it

### Secret exposure — the critical check

Open DevTools → Network, use the app normally, then search all responses and all
loaded JS for each value:

- [ ] `GEMINI_API_KEY` — **absent**
- [ ] `SUPABASE_SECRET_KEY` — **absent**
- [ ] `GOOGLE_CLIENT_SECRET` — **absent**
- [ ] `TOKEN_ENCRYPTION_KEY` — **absent**
- [ ] No Google access or refresh token in any response

If any appears, stop, rotate that secret, fix the leak, redeploy.

### Google

- [ ] Calendar loads real events
- [ ] Gmail search returns real messages
- [ ] Draft creation requires approval, and the draft appears in Gmail
- [ ] **There is no way to send email anywhere in the interface**
- [ ] Simulating a refresh failure sets `needs_reconnection` and shows the banner
- [ ] Reconnect restores the connection
- [ ] OAuth consent screen is in **Production** status — otherwise Google access
      dies after 7 days ([GOOGLE_OAUTH_SETUP.md](./GOOGLE_OAUTH_SETUP.md))

### Voice

- [ ] A voice session starts on desktop
- [ ] A voice session starts on **mobile Safari** — the most restrictive target
- [ ] Interruption works
- [ ] Reconnection works after a network drop
- [ ] Text fallback works

### Data and safety

- [ ] Approvals appear and can be approved, rejected and edited
- [ ] An approval cannot execute twice (double-click the button)
- [ ] An expired approval cannot execute
- [ ] Export produces a complete file
- [ ] Complete deletion removes everything and is clearly labelled irreversible

### Interface

- [ ] Desktop sidebar navigation works
- [ ] Mobile bottom navigation works
- [ ] Reduced-motion preference is respected
- [ ] Focus states are visible when navigating by keyboard
- [ ] Contrast is sufficient in both themes

---

## Deploy previews

Netlify builds a preview for every pull request. Two cautions:

1. Preview URLs are **not** in the Google authorised redirect list, so OAuth
   will fail there. That is intentional — do not add wildcard redirect URIs to
   work around it.
2. Previews share the production Supabase project unless you configure a
   separate one. Be careful with destructive testing.

---

## Rollback

**Deploys → select the last known-good deploy → Publish deploy.**

Instant, and does not require a rebuild. Note that this rolls back the
*application*, not the *database* — a deploy that ran a migration needs the
migration reversed separately. See [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md)
§ Rollback guidance.

---

## Monitoring

- **Netlify → Functions** — invocation counts and errors for route handlers
- **Netlify → Analytics** — traffic (optional, paid)
- **Supabase → Logs** — database and auth
- **Supabase → Edge Functions → Logs** — scheduled jobs
- **In-app `/history`** — what Atlas actually did
- **In-app usage dashboard** — Gemini consumption against the budget

---

## Troubleshooting

**Build fails: "Invalid environment variables"**
Working as designed. The error names the missing or malformed variable.

**Build succeeds, runtime 500s**
Almost always a server-only variable that is set locally but not on Netlify.
Compare the Netlify variable list against `.env.example`.

**OAuth `redirect_uri_mismatch` in production**
`NEXT_PUBLIC_APP_URL`, the Google authorised redirect URIs and the Supabase URL
configuration disagree. All three must match exactly.

**A `NEXT_PUBLIC_` value is stale**
Those are baked in at build time. Change it, then **redeploy** — restarting is
not enough.

**Voice fails only in production**
Check the Content-Security-Policy `connect-src`: it must allow both
`https://generativelanguage.googleapis.com` and
`wss://generativelanguage.googleapis.com`.

More in [TROUBLESHOOTING.md](./TROUBLESHOOTING.md).
