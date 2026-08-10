# MAD'S ATLAS UPGRADE REPORT

## 1. READY TO DEPLOY

**YES — local release candidate ready for the single production deployment.**

No deployment, branch push, production database write, or Netlify build was
triggered during this upgrade. The remaining live checks require the existing
production credentials and an authenticated physical iPhone session, so they
belong to the one post-deployment smoke test rather than repeated preview
deployments.

## 2. PERFORMANCE

### Before

- Reported Today → Talk transitions: approximately 5–10 seconds.
- Every matched request called `supabase.auth.getUser()` in middleware.
- The authenticated layout called `requireOwner()` (`getUser` + allowlist RPC)
  and then blocked on a separate profile query.
- Pages such as Today and Calendar repeated owner/profile work.
- Today blocked the entire RSC response on tasks, reminders, approvals,
  connection state, profile, briefing, token lookup, and Google Calendar.

### After

- The Next 16 request proxy uses `getClaims()`: asymmetric Supabase projects can
  validate with cached JWKS instead of an Auth network request on every route.
- Authenticated user, owner decision, profile, settings, and connection reads
  are request-memoised. Security is unchanged: server owner validation,
  allowlist RPC, and RLS all remain.
- The shell no longer waits for the profile query; profile identity streams into
  the already-rendered sidebar.
- Today starts work, approvals, profile, briefing, and Google Calendar in
  parallel. Priorities, Calendar, attention, and intelligence have independent
  Suspense/loading boundaries. Google latency no longer freezes the page.
- Calendar renders its page shell immediately and reports `CALENDAR // SYNCING`
  while Google resolves.
- Talk no longer declares unnecessary page-level `force-dynamic`; microphone,
  token, audio, and WebSocket work still starts only after the user presses the
  microphone button.
- The production Talk page client chunk is approximately 24 KiB uncompressed;
  the authenticated shell client chunk is approximately 16 KiB uncompressed.
- Baseline production build: 9.12 seconds. Final upgraded production build:
  about 8.2 seconds wall-clock in this workspace. Build duration is not
  navigation latency and is recorded only as
  a reproducibility metric.

An authenticated before/after navigation trace could not be collected locally
because this checkout intentionally contains no `.env.local` or user session.
The architecture-level blocking work has been removed; confirm the perceived
transition on the physical-device smoke test.

## 3. UI/UX

- Preserved the existing premium forest/gold design while adding restrained HUD
  corners, scanning skeletons, status micro-labels, orbital detail, and useful
  state colour.
- Added immediate route loading and useful workspace-level recovery UI.
- Improved Today as the command centre without adding dashboard clutter.
- Research now communicates real in-flight searching/cross-checking/synthesis
  without artificially delaying results.
- Task completion retains optimistic feedback and now has a true 44px touch
  target.
- Corrected stale Calendar approval copy: explicit event creation is direct,
  validated, and logged.
- Research remains in primary product navigation instead of Inbox; Gmail
  capability is preserved but visually secondary.

## 4. MOBILE/PWA

- Added App Router `manifest.webmanifest` with `display: standalone`, Atlas
  colours, scope, start URL, and sensible unrestricted orientation.
- Added Apple standalone metadata, Apple Touch Icon, `viewport-fit=cover`,
  dynamic viewport units, and top/bottom/left/right safe-area handling.
- Added regular 192px/512px PWA icons, a safe-zone maskable 512px icon, 180px
  Apple icon, and 32px/48px browser icons.
- Assets are deterministic crops/resizes of the supplied official artwork.
  There is no generated or redesigned emblem.
- No service worker was introduced. Private authenticated content is not placed
  into an offline cache; standalone installation is the priority.

## 5. VOICE

- Verified the installed `@google/genai` 2.16.0 types and current official
  Gemini Live configuration shape.
- Selected **Charon** as Atlas's fixed informative chief-of-staff voice.
- Locked the voice in both the server-minted ephemeral-token constraint and the
  browser Live setup message through
  `speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName`.
- Selected **Orus** as the one predetermined fallback. Atlas never randomises or
  rotates voices.
- Preserved one-use ephemeral tokens, server-only API key, direct browser Live
  WebSocket, PCM, transcription, interruption, tools, resumption, teardown,
  budget controls, and current ScriptProcessor compatibility.
- Atlas Core now uses the canonical emblem inside responsive orbital geometry.
  It responds to real microphone energy while listening and real decoded PCM
  energy while Atlas responds.
- Voice labels now use `ATLAS // STANDBY`, `CONNECTING`, `LISTENING`,
  `PROCESSING`, `EXECUTING`, `RESPONDING`, and `ERROR` semantics. Microphone
  status copy now remains truthful during processing and response states.

## 6. FEATURES

- Tasks, reminders, Calendar event creation, grounded research, memory, daily
  briefings, approvals, settings, Gmail boundaries, and action history remain.
- Preferred-name and intelligence settings persistence code is unchanged and
  continues to revalidate Settings/Today after confirmed database writes.
- Calendar creation remains direct at the validated Level 1 tool boundary; no
  unnecessary approval record is created.
- Existing memory safety exclusions and server-side memory-enable check remain.
- Existing action logs and duration fields provide a privacy-preserving
  foundation for future tool/API health measurement.

## 7. SECURITY

- Owner access remains enforced in protected server code, not in the proxy.
- Email match, enabled allowlist RPC, RLS, input schemas, permission registry,
  token encryption, rate limits, and no-send/no-delete/no-financial boundaries
  remain intact.
- `getClaims()` replaces only the proxy's unused refresh read; protected code
  still uses server-verified `getUser()`.
- No secret was added to client props, public environment variables, source,
  icons, logs, manifest, or browser bundles.
- CSP, HSTS, frame denial, content-type protection, referrer policy, and narrow
  microphone permission policy remain.
- Automated secret/history/dependency audit: no issues found.

## 8. DATABASE

- **No migration required.**
- No schema, RLS policy, function, index, seed, or production row was changed.
- Database-backed integration tests that require `SUPABASE_DB_URL` remain
  available for the credentialed environment; the credential-free subset ran
  locally.

## 9. ENVIRONMENT VARIABLES

### Unchanged required

- `NEXT_PUBLIC_APP_URL`
- `ATLAS_OWNER_EMAIL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `GEMINI_API_KEY`
- `GEMINI_LIVE_MODEL`
- `GEMINI_TEXT_MODEL`
- `GEMINI_EMBEDDING_MODEL`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `TOKEN_ENCRYPTION_KEY`

### New required

- None.

### Optional / environment-specific

- `ATLAS_TIMEZONE` (defaults to `Asia/Singapore`)
- `GOOGLE_REDIRECT_URI`
- `SUPABASE_DB_URL` (integration tests and database tooling)
- `SENTRY_DSN`

### Deprecated

- None.

`GEMINI_LIVE_VOICE` is intentionally not required: voice identity is a public,
centralised product constant, not a secret or deploy-time variable.

## 10. GOOGLE

- Existing Calendar and Gmail OAuth scopes are preserved.
- No Google Cloud setting or new scope is required by this release.
- Keep the OAuth consent screen in Production and retain the existing Supabase
  callback plus application callback/origin configuration.
- After deployment, reconnecting Google is not expected unless the existing
  production credentials/scopes have changed.

## 11. NETLIFY

- Existing `npm run build`, Node 22, and `@netlify/plugin-nextjs` architecture is
  unchanged.
- `npm run build` explicitly selects Next's supported webpack production
  builder. This avoids a Turbopack worker-socket panic found during the exact
  release command and makes Netlify run the same builder verified locally.
- No manual publish directory or extra Netlify plugin was added.
- No deployment was triggered during development.
- Manifest, icons, and App Router metadata are included by the normal Next build.

## 12. TEST RESULTS

- TypeScript: pass.
- ESLint: pass.
- Unit tests: 206 passed across 14 files.
- Production build (Next 16.3, webpack): pass.
- Security audit: pass, no issues.
- Browser E2E: 26 passed, 2 project-inapplicable checks skipped across desktop
  Chrome and mobile Chromium. This includes the standalone manifest, Apple
  metadata, canonical icon paths, access control, responsive sign-in, and
  browser secret-containment assertions.
- Integration suite: 19 passed; 78 database-backed checks skipped because this
  checkout has no `SUPABASE_DB_URL`/local PostgreSQL harness.
- Canonical source crop, maskable safe zone, 32px legibility, local sign-in,
  and served manifest were visually/semantically inspected.

## 13. REMAINING TECHNICAL DEBT

- Physical iPhone Safari/standalone authenticated smoke test is still required.
- Live Charon voice output and tool execution require the real Gemini/Google
  credentials and cannot be proven from the credential-free checkout.
- Authenticated navigation timing should be captured once in production after
  deploy; do not infer a precise millisecond result from build timing.
- `ScriptProcessorNode` remains for Safari compatibility and stability. An
  AudioWorklet migration should be a separate measured release.
- Full database RLS/integration coverage requires the documented local DB
  harness or `SUPABASE_DB_URL`.

## 14. FUTURE ATLAS IMPROVEMENTS

- Privacy-preserving internal navigation and provider-latency aggregates.
- An AudioWorklet experiment behind tests, only if measured to improve voice.
- Richer Calendar conflict/free-time views without blocking the page shell.
- Observation/inference review workflows that never silently promote uncertain
  behaviour into permanent memory.
- Owner-reviewed upgrade proposals that hand work to a code agent/branch and
  never self-deploy.

## 15. EXACT DEPLOYMENT STEPS

1. In Netlify, confirm the unchanged required environment variables above are
   present for Production. Do not add a new voice variable.
2. Confirm Google OAuth remains Production and its existing redirect URIs are
   unchanged.
3. Review and commit this branch, then push it once.
4. Merge the completed branch using the repository's normal review path.
5. Trigger **one** Netlify production deployment and wait for the build to pass.
6. On the physical iPhone, remove the old Home Screen icon if iOS retains it,
   open the production URL in Safari, and choose Add to Home Screen again.
7. Launch the installed app and smoke-test: sign in, Today immediate shell,
   Today → Talk, one Charon voice session, one task/reminder tool call, one
   direct Calendar event, Research, memory recall, briefing toggle persistence,
   and preferred name `Mad`.
8. Confirm `/api/health` reports `ok` and review Netlify logs only for safe
   status/error codes—not token or content values.

If any live smoke check fails, stop and fix that subsystem before asking Mad to
continue normal use. Do not create repeated speculative Netlify deployments.
