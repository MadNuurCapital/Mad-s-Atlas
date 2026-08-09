# Atlas Ideas & Planner

## What it adds

Ideas are durable objects rather than chat claims. Atlas preserves the owner's
exact words, forms a concise understanding, keeps constraints separate, checks
Google Calendar, and prepares one practical plan for approval. Only approval
creates or updates the existing Tasks, Reminders and Calendar blocks.

The lifecycle is:

`IDEA → UNDERSTAND → IMPROVE → PLAN → REMIND → EXECUTE`

Active plans expose one next action. Re-planning preserves the original Idea,
instructions, completed steps and Idea-local notes, while revising only
unfinished work around current Calendar commitments. Today shows one compact
next-plan card.

## Cleanup and safety

- Archive and restore never alter linked records.
- Permanent deletion is an approval with independent choices for linked Tasks,
  Reminders and Atlas-created Calendar events.
- If any linked record changes after approval, execution refuses the stale
  payload.
- Ideas quiet for 90 days appear in `Atlas // Idea cleanup` with Keep, Archive,
  and review-before-Delete. Nothing automatically permanently deletes them.
- Notes stay inside their Idea unless the owner separately asks Atlas to store
  something in global Memory.

## Voice and notifications

Gemini Live exposes the full capture/propose/approve/update lifecycle. It must
capture before planning and may approve only after an explicit yes. Direct
address transcription tolerates Alice, Ellis, At last and LS without rewriting
those words elsewhere.

Hands-free remains the default. While Atlas speaks, microphone PCM is not sent,
preventing Atlas from hearing its own output. Tap the core to interrupt. Focus
mode enables hold-to-talk for noisy or shared-phone situations.

Push sends at most three useful alerts per scheduled step: 15-minute upcoming,
start-time execute, and one missed-session check after 60 minutes. Actions deep
link to the exact plan and can mark the step Done.

## Deployment order

Do not deploy pieces independently. For one release:

1. Apply `20260809000014_atlas_ideas_planner.sql` in Supabase.
2. Add the three VAPID secrets documented in `.env.example` to Supabase Edge
   Functions. Keep `NEXT_PUBLIC_VAPID_PUBLIC_KEY` in Netlify.
3. Deploy the updated `check-reminders` Edge Function.
4. Confirm the existing `check_reminders` cron is active every five minutes.
5. Merge and deploy the web application once.
6. Open Settings → Notifications on each device and enable it. On iPhone,
   install Atlas to the Home Screen first.

No additional Google OAuth scope is required beyond the existing Calendar read
and events scopes.
