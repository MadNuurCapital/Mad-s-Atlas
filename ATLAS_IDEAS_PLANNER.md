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

## Voice and reminders

Gemini Live exposes the full capture/propose/approve/update lifecycle. It must
capture before planning and may approve only after an explicit yes. Direct
address transcription tolerates Alice, Ellis, At last and LS without rewriting
those words elsewhere.

Hands-free remains the default. While Atlas speaks, microphone PCM is not sent,
preventing Atlas from hearing its own output. Tap the core to interrupt. Focus
mode enables hold-to-talk for noisy or shared-phone situations.

Approved plans create lightweight in-app Reminder records linked to their exact
Idea and step. Atlas does not run a background push worker; reminders remain
visible in Atlas without relying on browser notification permissions.

## Deployment order

Do not deploy pieces independently. For one release:

1. Apply `20260809000014_atlas_ideas_planner.sql` in Supabase.
2. Apply `20260810000015_remove_push_reminder_worker.sql` to retire the legacy
   push cron without deleting any Ideas or Reminders.
3. Merge and deploy the web application once.

No additional Google OAuth scope is required beyond the existing Calendar read
and events scopes.
