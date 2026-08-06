# Google OAuth Setup — Mad's Atlas

Sign-in, Gmail and Calendar all run through one Google OAuth client.

**Read the "Testing vs Production" section before you finish.** It is the single
most important step in this document, and getting it wrong makes the app appear
to work for a week and then break.

---

## Scopes

Exactly these, and nothing more:

| Scope | Why |
|---|---|
| `openid` | Sign-in |
| `email` | Owner verification |
| `profile` | Display name and avatar |
| `https://www.googleapis.com/auth/calendar.readonly` | Read the calendar |
| `https://www.googleapis.com/auth/calendar.events` | Create and update events, after approval |
| `https://www.googleapis.com/auth/gmail.readonly` | Search, read and summarise mail |
| `https://www.googleapis.com/auth/gmail.compose` | Create drafts — **compose does not send** |

### Deliberately not requested

| Scope | Why not |
|---|---|
| `gmail.send` | Sending is Level 3. Without the scope, it is impossible, not merely disabled. |
| `gmail.modify` | Not needed to read or draft |
| Any Drive scope | No Drive functionality |
| Contacts | Not in V1 |
| Broad account scopes | No justification |

`gmail.readonly` and `gmail.compose` are **restricted** scopes. `calendar.events`
is **sensitive**. That classification is why the consent screen behaves the way
it does below.

---

## Step 1 — Google Cloud project

1. <https://console.cloud.google.com/>
2. Project selector → **New Project**
3. Name: `mads-atlas`. No organisation. **Create**.
4. Select it.

## Step 2 — Enable the APIs

**APIs & Services → Library**, then enable both:

- **Gmail API**
- **Google Calendar API**

Or with the gcloud CLI:
```bash
gcloud services enable gmail.googleapis.com calendar-json.googleapis.com
```

## Step 3 — OAuth consent screen

**APIs & Services → OAuth consent screen**

1. **User type: External.**
   Internal requires a Google Workspace domain. Muhammad uses a personal
   `@gmail.com`, so External is the only option. This choice drives everything
   in the Testing vs Production section.
2. **Create**, then fill in:
   - App name: `Mad's Atlas`
   - User support email: Muhammad's email
   - App logo: optional
   - Application home page: your `NEXT_PUBLIC_APP_URL`
   - Authorised domains: `netlify.app` (or your custom domain)
   - Developer contact: Muhammad's email
3. **Save and continue**.

### Add the scopes

**Add or remove scopes** → paste each of the seven scopes above → **Update** →
**Save and continue**.

Google will warn that some are sensitive or restricted. That warning is
expected, and for a single-user personal application it is acceptable.

### Test users

Add Muhammad's exact email address as a test user. Do this even though you will
publish — it keeps sign-in working while the app is still in Testing.

---

## ⚠ Testing vs Production — read this

This is the trap.

| | Testing | Production |
|---|---|---|
| Who can sign in | Only listed test users | Anyone who gets past your allowlist |
| Consent screen | "Google hasn't verified this app" | Same, until verified |
| **Refresh token lifetime** | **Expires after 7 days** | **Does not expire** |

**A refresh token that expires every 7 days breaks Mad's Atlas.** The daily
briefing, reminder checks and meeting preparation all run at 01:00 UTC with no
browser present. They need a valid refresh token. In Testing status, they would
work for a week and then silently stop — and because the failure is in a cron
job, nothing on screen would obviously break.

### The Gmail scopes change everything — read this

Google grades scopes. `calendar.readonly` and `calendar.events` are
**sensitive**. `gmail.readonly` and `gmail.compose` are **restricted**, which
is a stricter tier, and the difference decides what you can actually do.

| Publishing status | Sensitive scopes only | With restricted Gmail scopes |
|---|---|---|
| **Testing** | Works for test users | **Works for test users** |
| **Production, unverified** | Works after the "unsafe" warning | **BLOCKED — sign-in fails** |
| **Production, verified** | Works | Works, but needs a CASA Tier 2 security audit |

Publishing an unverified app that requests Gmail scopes does not show a warning
you can click past. Google refuses outright:

```
Access blocked: <project>.supabase.co has not completed
the Google verification process
Error 403: access_denied
```

Verifying restricted scopes requires a **CASA Tier 2 assessment** by an
approved third-party assessor — an annual, paid engagement. That is not a
realistic path for a single-user personal application.

### So pick one of these

**A — Testing status with yourself as a test user.** Sign-in works today, with
all Gmail and Calendar features. The cost: Google expires the refresh token
every **7 days**, so you must reconnect Google weekly, and the scheduled jobs
degrade until you do. Atlas handles this honestly — the connection shows
`needs_reconnection` and the briefing says which sections are missing.

**B — Drop the Gmail scopes.** Keep only `calendar.readonly` and
`calendar.events`. Those are sensitive, not restricted, so an unverified
Production app works after clicking through the warning once, and refresh
tokens do **not** expire. You lose Gmail search, summaries and drafts. Remove
them from `SCOPES` in `src/features/auth/SignInButton.tsx` and from the
Supabase Google provider config.

**C — Use a Google Workspace account.** With Workspace on a domain you own, the
OAuth app can be type **Internal**: no verification, no 7-day expiry, full
Gmail access. This is the only option that gives everything at once, and it
costs a Workspace subscription.

### To use option A (recommended to start)

1. Google Cloud Console → **APIs & Services → OAuth consent screen**
2. If status is "In production", click **Back to testing**
3. Under **Test users**, click **+ ADD USERS**
4. Add your exact owner address, then **Save**
5. Sign in again — it will now work

---

## Step 4 — OAuth client credentials

**APIs & Services → Credentials → Create credentials → OAuth client ID**

- Application type: **Web application**
- Name: `Mad's Atlas Web`

**Authorised JavaScript origins**
```
http://localhost:3000
https://<your-site>.netlify.app
```

**Authorised redirect URIs** — these must match *exactly*, character for
character:
```
https://<your-project-ref>.supabase.co/auth/v1/callback
http://localhost:3000/auth/callback
https://<your-site>.netlify.app/auth/callback
```

The Supabase callback is the one that matters for sign-in. The others support
local development and any direct-callback flow.

**Create**, then copy:
- Client ID → `GOOGLE_CLIENT_ID`
- Client secret → `GOOGLE_CLIENT_SECRET` ⚠ server-only

Set `GOOGLE_REDIRECT_URI` to the Supabase callback URL.

---

## Step 5 — Wire it into Supabase

**Supabase Dashboard → Authentication → Providers → Google**

1. Enable.
2. Client ID → your `GOOGLE_CLIENT_ID`
3. Client Secret → your `GOOGLE_CLIENT_SECRET`
4. **Additional scopes** — paste space-separated:
   ```
   https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose
   ```
5. Save.

**Authentication → URL Configuration**
- Site URL: your `NEXT_PUBLIC_APP_URL`
- Redirect URLs: add `http://localhost:3000/**` and
  `https://<your-site>.netlify.app/**`

---

## Offline access and refresh tokens

To receive a refresh token at all, the sign-in request must ask for it:

```ts
await supabase.auth.signInWithOAuth({
  provider: 'google',
  options: {
    scopes: [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.compose',
    ].join(' '),
    queryParams: {
      access_type: 'offline',   // required for a refresh token
      prompt: 'consent',        // forces a NEW refresh token to be issued
    },
    redirectTo: `${appUrl}/auth/callback`,
  },
});
```

### The rule that must never be broken

**Google returns a refresh token on first consent, and often not afterwards.**

```
On the OAuth callback:
  if provider_refresh_token is present  → encrypt and store it
  if provider_refresh_token is absent   → KEEP the existing one
  never write null or '' over a valid stored token
```

This is enforced in three places, because losing the refresh token silently is
the worst realistic failure in this system:

1. Application logic in the callback handler.
2. A database trigger on `connected_accounts` that raises an exception on any
   update nulling a non-null `encrypted_refresh_token`.
3. A dedicated integration test that simulates a re-login with no refresh token
   and asserts the stored one survives.

### Token lifecycle

```
CONNECTED
   │ access token expires (~1 hour)
   ▼
REFRESH server-side
   ├─ success → new access token, last_refreshed_at updated → CONNECTED
   └─ failure → NEEDS RECONNECTION
                 ├─ persistent "Reconnect Google" banner in the UI
                 ├─ scheduled jobs skip Google steps and say so plainly
                 └─ Muhammad re-consents → CONNECTED
```

Refresh failure is a normal state, not an exception. It is displayed honestly,
never retried into oblivion, and never allowed to make a briefing look complete
when it is not.

---

## Reconnect flow

Reachable from **Settings → Google connection** and from the banner.

1. Show the current status, the connected email, and the granted scopes.
2. **Reconnect** starts the OAuth flow with `prompt=consent` so a fresh refresh
   token is issued.
3. On success: store both tokens, `connection_status = 'connected'`, clear
   `last_error`.
4. **Disconnect** deletes the stored tokens and tells Muhammad to also revoke at
   <https://myaccount.google.com/permissions> if he wants Google's side cleared.

---

## Verification

- [ ] Sign in with the owner account → succeeds
- [ ] Sign in with any other Google account → rejected with "This application is
      private."
- [ ] `connected_accounts` has a row with non-null encrypted tokens
- [ ] `granted_scopes` contains all four API scopes
- [ ] Calendar reads return real events
- [ ] Gmail search returns real messages
- [ ] Creating a draft requires approval, and the draft appears in Gmail
- [ ] **There is no way to send email**
- [ ] Simulated refresh failure → status becomes `needs_reconnection` and the
      banner appears
- [ ] Reconnect restores a working connection
- [ ] OAuth consent screen status is **In production**

---

## Troubleshooting

**`redirect_uri_mismatch`**
The URI in the request is not in the authorised list. Compare character by
character — trailing slashes and `http` vs `https` both matter.

**`access_denied`**
Either consent was declined, or the app is in Testing and the account is not a
test user.

**No refresh token returned**
`access_type=offline` is missing, or Google already issued one for this
client/account pair. Force a new one with `prompt=consent`, or revoke at
<https://myaccount.google.com/permissions> and consent again.

**Google access stops working every 7 days**
The classic symptom. The OAuth app is still in **Testing**. Publish it to
Production.

**`insufficient_permission` from Gmail or Calendar**
The scope was not granted. Check `granted_scopes` on the row — consent can
return fewer scopes than requested. Reconnect with `prompt=consent`.
