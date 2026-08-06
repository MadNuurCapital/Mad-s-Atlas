# Gemini Live Setup — Mad's Atlas

Realtime voice, and the ephemeral-token security model that makes it safe to run
from a browser.

---

## Models

Three separate, independently configurable models. Verified current as of
August 2026.

| Variable | Value | Used for |
|---|---|---|
| `GEMINI_LIVE_MODEL` | `gemini-3.1-flash-live-preview` | Realtime conversation |
| `GEMINI_TEXT_MODEL` | `gemini-3.6-flash` | Reasoning, research, briefings, summaries, memory extraction |
| `GEMINI_EMBEDDING_MODEL` | `gemini-embedding-001` | Semantic memory (1536 dimensions) |

**No model ID is hard-coded anywhere in the codebase.** Preview identifiers
change without notice, and silently running a deprecated model is a correctness
bug. Startup logs the configured model names — never keys.

### Before implementing

Verify availability against the official SDK rather than trusting this document:

```bash
npm install @google/genai
```

```ts
const models = await ai.models.list();
console.log(models.map((m) => m.name));
```

If `GEMINI_LIVE_MODEL` is not in the list, update the environment variable —
never patch a fallback into the code.

### Superseded Live models

Do not use: `gemini-2.5-flash-native-audio-preview-12-2025`,
`gemini-live-2.5-flash-preview`, `gemini-2.0-flash-live-001`. All are shut down.

---

## Get an API key

1. <https://aistudio.google.com/apikey>
2. **Create API key**, in the same Google Cloud project if you want unified
   billing.
3. Copy it into `GEMINI_API_KEY` — Netlify environment **and** Supabase Edge
   secrets.

⚠ This key is never sent to the browser. Not in a prop, not in a response, not
in a bundle. The browser gets an ephemeral token instead.

---

## The ephemeral-token model

The browser connects **directly** to the Gemini Live WebSocket, because
proxying audio through Netlify would add latency without adding safety — the
token is the control.

```
1  Browser  POST /api/gemini/live-token
2  Server   verify Supabase session
            verify session email == ATLAS_OWNER_EMAIL and allowlist enabled
            rate-limit (per minute and per day)
            check the voice budget
            mint an ephemeral token:
              uses: 1
              locked to GEMINI_LIVE_MODEL
              response modalities restricted
              new-session expiry: ~1 minute  (time to START a session)
              max session expiry:  ~30 minutes (total session lifetime)
3  Server   log the issuance — user, model, timestamp. NEVER the token.
4  Server   return { token, sessionConfig }
5  Browser  open WSS to Gemini Live with the token
6  Session  audio in, audio out, transcripts stream to the UI
7  Tools    intents route BACK to the server for validate → decide → execute.
            The Live session cannot execute anything itself.
8  Drop     ~10 minute connection lifetime → session resumption reconnects
```

### What the endpoint must do

```
/api/gemini/live-token          POST, authenticated

1  Verify the Supabase session server-side
2  Verify the authenticated owner
3  Apply rate limiting
4  Request a one-use Gemini ephemeral token
5  Restrict the token to the configured Live model
6  Restrict response modalities appropriately
7  Use a short new-session expiry
8  Use a reasonable maximum session expiry
9  Return only the ephemeral token and safe session configuration
10 Log token issuance without logging the token
```

A failure at any of steps 1–3 returns `401` or `429` with no detail about why
beyond what the user needs.

### Implementation note

The exact SDK call shape for token creation must be confirmed against the
installed `@google/genai` types at the start of Phase 5 — the surface has moved
between SDK versions, and this document should not be trusted over the types on
disk. Read the type definitions first, then write the endpoint.

---

## Session limits

| Limit | Value | Consequence |
|---|---|---|
| Connection lifetime | ~10 minutes | Session resumption is **required**, not optional |
| Audio-only session without compression | ~15 minutes | Longer sessions need context compression |
| Context window (native audio) | 128k tokens | Long conversations must summarise |
| Our maximum session | 30 minutes | Cost control — see [PERMISSIONS.md](./PERMISSIONS.md) |

Session resumption reconnects transparently. The UI shows `reconnecting`; it
does not pretend the session is still live, and it does not silently lose the
conversation.

---

## Voice experience

### Controls

- Microphone permission handling, requested at the moment of use with a clear
  explanation — never on page load
- **Push-to-talk** — the default
- **Hands-free** — optional, requires explicit activation each session
- Start session / End session
- Mute
- Interrupt (barge-in) — Muhammad can talk over Atlas and it stops
- Text fallback, always available

### States

Exactly one is shown at a time:

| State | Meaning |
|---|---|
| `idle` | Not connected |
| `listening` | Microphone genuinely live and capturing |
| `understanding` | Processing the utterance |
| `using_tool` | Executing a tool, with the tool named |
| `speaking` | Atlas is talking |
| `reconnecting` | Connection dropped, resumption in progress |
| `error` | Something failed, with a plain explanation |

**The UI never displays "listening" when the microphone is inactive.** This is a
privacy commitment, not a UI detail.

### Transcripts

Live user transcript and live Atlas transcript both render as they arrive.
Latency is indicated visibly so a slow response looks slow rather than broken.

### Privacy

- Raw audio is **never** stored — not on our servers, not in the browser, not on
  disk.
- Transcripts are session-only unless explicitly saved.
- Ending a session releases the media stream, and the browser's microphone
  indicator goes dark.
- There is no always-on background microphone in V1.

---

## Tool calls from voice

Voice tool calls take the **same** server path as text. There is no looser route
for voice.

```
Live session detects intent
  → browser POSTs the proposal to /api/atlas/message
  → server: Zod validation → permission level → budget
  → Level 1: execute, return the result
    Level 2: create an approval, return "awaiting approval"
    Level 3: refuse
  → result is spoken and displayed
```

The Live session has no database credential, no Google token and no execution
capability. It proposes; the server decides.

---

## Cost control

Voice is the most expensive path in the product:

- Per-minute voice cap
- Daily session cap
- Maximum session length (30 minutes)
- Token issuance is rate-limited, so a leaked page cannot mint tokens in a loop
- Usage is recorded per session and shown in the dashboard
- Reaching a limit produces a spoken, plain refusal — never a silent
  disconnection

---

## Verification

- [ ] `/api/gemini/live-token` returns `401` when signed out
- [ ] It returns `401` for a non-owner session
- [ ] It returns `429` when rate-limited
- [ ] The returned token is single-use — a second connection with it fails
- [ ] **`GEMINI_API_KEY` appears nowhere in browser network traffic or bundles**
- [ ] A voice session starts and Atlas responds
- [ ] Interruption works — talking over Atlas stops it
- [ ] Dropping the network shows `reconnecting`, then recovers
- [ ] Text fallback works with voice unavailable
- [ ] Ending the session turns off the browser microphone indicator
- [ ] No audio is written anywhere
- [ ] A tool call from voice follows the same approval path as from text

---

## Troubleshooting

**`401` from the token endpoint**
Not signed in, or the session email does not match `ATLAS_OWNER_EMAIL`. Check
the server logs for the owner-verification outcome.

**WebSocket closes immediately after connecting**
The token was already used, or it expired before the connection opened. The
new-session expiry is deliberately short — mint the token immediately before
connecting, not on page load.

**"Model not found"**
`GEMINI_LIVE_MODEL` names a model that no longer exists. List available models
via the SDK and update the environment variable.

**Session drops at ten minutes**
Expected. Session resumption should reconnect automatically. If it does not,
resumption is not implemented correctly — this is a Phase 5 requirement.

**No audio output**
Browser autoplay policy blocks audio without a user gesture. Audio playback must
be initiated from the click that starts the session.

**Microphone permission denied**
Cannot be re-prompted programmatically. Show instructions for re-enabling it in
browser settings, and offer text fallback immediately.
