/**
 * Reminder and Ideas plan delivery — every five minutes.
 *
 * Push credentials are read only with the service role and are never returned
 * or logged. Every delivery has a deterministic job claim and every Idea step
 * stores its sent timestamp, so overlapping cron invocations cannot spam.
 */

import webpush from 'npm:web-push@3.6.7';

import { adminClient, claimRun, finishRun, isAuthorisedCaller } from '../_shared/job.ts';
import { nextOccurrence } from '../_shared/recurrence.ts';

type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth_secret: string;
};

type PushPayload = {
  title: string;
  body: string;
  url: string;
  tag: string;
  stepId?: string;
  ideaId?: string;
  actions?: Array<{ action: string; title: string }>;
};

function configureWebPush(): void {
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
  const subject = Deno.env.get('VAPID_SUBJECT') ?? '';
  if (!publicKey || !privateKey || !subject) {
    throw new Error('VAPID configuration is incomplete.');
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

async function subscriptionsFor(supabase: ReturnType<typeof adminClient>, userId: string) {
  const { data, error } = await supabase
    .from('notification_subscriptions')
    .select('id,endpoint,p256dh,auth_secret')
    .eq('user_id', userId)
    .eq('enabled', true);
  if (error) throw new Error(`subscription_lookup:${error.code ?? 'failed'}`);
  return (data ?? []) as PushSubscriptionRow[];
}

async function deliver(
  supabase: ReturnType<typeof adminClient>,
  subscriptions: PushSubscriptionRow[],
  payload: PushPayload,
): Promise<number> {
  let sent = 0;
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth_secret },
        },
        JSON.stringify(payload),
        { TTL: 300, urgency: 'normal' },
      );
      sent += 1;
    } catch (error) {
      const statusCode = Number((error as { statusCode?: number }).statusCode ?? 0);
      if (statusCode === 404 || statusCode === 410) {
        await supabase
          .from('notification_subscriptions')
          .update({ enabled: false })
          .eq('id', subscription.id);
      }
    }
  }
  return sent;
}

Deno.serve(async (request: Request) => {
  if (!isAuthorisedCaller(request)) {
    return new Response(JSON.stringify({ error: 'Unauthorised.' }), { status: 401 });
  }

  const startedAt = Date.now();
  const supabase = adminClient();
  try {
    configureWebPush();
  } catch {
    return new Response(JSON.stringify({ error: 'Push delivery is not configured.' }), { status: 503 });
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const horizon = new Date(now.getTime() + 5 * 60_000).toISOString();
  const recent = new Date(now.getTime() - 10 * 60_000).toISOString();
  const planCheckCutoff = new Date(now.getTime() - 60 * 60_000).toISOString();
  const planCheckFloor = new Date(now.getTime() - 75 * 60_000).toISOString();
  let delivered = 0;

  // General reminders. Idea-linked reminders are delivered from idea_steps
  // below so the 15-minute, execute and plan-check sequence cannot duplicate.
  const { data: dueReminders } = await supabase
    .from('reminders')
    .select('id,user_id,title,remind_at,next_trigger_at,recurrence_rule,timezone,idea_step_id')
    .eq('status', 'scheduled')
    .is('idea_step_id', null)
    .lte('next_trigger_at', horizon)
    .limit(50);

  for (const reminder of dueReminders ?? []) {
    const triggerAt = (reminder.next_trigger_at ?? reminder.remind_at) as string;
    const claim = await claimRun(supabase, 'check_reminders', `reminder:${reminder.id}:${triggerAt}`);
    if (!claim.claimed) continue;

    try {
      const subscriptions = await subscriptionsFor(supabase, reminder.user_id as string);
      delivered += await deliver(supabase, subscriptions, {
        title: 'ATLAS // REMINDER',
        body: reminder.title as string,
        url: '/reminders',
        tag: `atlas-reminder-${reminder.id}-${triggerAt}`,
      });
      let nextTrigger: Date | null = null;
      if (reminder.recurrence_rule) {
        try {
          nextTrigger = nextOccurrence(
            reminder.recurrence_rule as string,
            new Date(reminder.remind_at as string),
            new Date(triggerAt),
            (reminder.timezone as string) || 'Asia/Singapore',
          );
        } catch {
          // The rule was validated on creation. If legacy data is malformed,
          // stop the series after its current delivery instead of looping.
        }
      }
      await supabase.from('reminders').update({
        last_triggered_at: nowIso,
        status: reminder.recurrence_rule ? (nextTrigger ? 'scheduled' : 'completed') : 'triggered',
        next_trigger_at: nextTrigger?.toISOString() ?? null,
      }).eq('id', reminder.id);
      await finishRun(supabase, claim.runId, { status: 'succeeded' }, startedAt);
    } catch (error) {
      await finishRun(supabase, claim.runId, {
        status: 'failed',
        errorCode: error instanceof Error ? error.message.slice(0, 80) : 'unknown',
      }, startedAt);
    }
  }

  const { data: upcoming } = await supabase
    .from('idea_steps')
    .select('id,user_id,idea_id,title,scheduled_start,ideas!inner(title,status)')
    .in('status', ['pending', 'in_progress'])
    .eq('notify_upcoming', true)
    .is('upcoming_notified_at', null)
    .gte('scheduled_start', new Date(now.getTime() + 5 * 60_000).toISOString())
    .lte('scheduled_start', new Date(now.getTime() + 15 * 60_000).toISOString())
    .limit(50);

  const { data: executing } = await supabase
    .from('idea_steps')
    .select('id,user_id,idea_id,title,scheduled_start,ideas!inner(title,status)')
    .in('status', ['pending', 'in_progress'])
    .eq('notify_execute', true)
    .is('execute_notified_at', null)
    .gte('scheduled_start', recent)
    .lte('scheduled_start', nowIso)
    .limit(50);

  const { data: missed } = await supabase
    .from('idea_steps')
    .select('id,user_id,idea_id,title,scheduled_end,task_id,ideas!inner(title,status)')
    .in('status', ['pending', 'in_progress'])
    .eq('notify_plan_check', true)
    .is('plan_check_notified_at', null)
    .gte('scheduled_end', planCheckFloor)
    .lte('scheduled_end', planCheckCutoff)
    .limit(50);

  const sendStep = async (
    step: Record<string, unknown>,
    kind: 'upcoming' | 'execute' | 'plan_check',
  ) => {
    const subscriptions = await subscriptionsFor(supabase, step.user_id as string);
    if (subscriptions.length === 0) return;
    const scheduled = String(step.scheduled_start ?? step.scheduled_end ?? '');
    const claim = await claimRun(supabase, 'check_reminders', `idea:${step.id}:${kind}:${scheduled}`);
    if (!claim.claimed) return;

    const title = kind === 'upcoming'
      ? 'ATLAS // UPCOMING'
      : kind === 'execute'
        ? 'ATLAS // EXECUTE'
        : 'ATLAS // PLAN CHECK';
    const body = kind === 'upcoming'
      ? `Your ${step.title} session starts in 15 minutes.`
      : kind === 'execute'
        ? `Time to ${String(step.title).toLocaleLowerCase()}.`
        : `“${step.title}” was not completed. Reschedule?`;
    const field = kind === 'upcoming'
      ? 'upcoming_notified_at'
      : kind === 'execute'
        ? 'execute_notified_at'
        : 'plan_check_notified_at';

    try {
      delivered += await deliver(supabase, subscriptions, {
        title,
        body,
        url: `/ideas/${step.idea_id}`,
        tag: `atlas-idea-${step.id}-${kind}`,
        stepId: step.id as string,
        ideaId: step.idea_id as string,
        actions: kind === 'plan_check'
          ? [{ action: 'done', title: 'Done' }, { action: 'reschedule', title: 'Reschedule' }]
          : [{ action: 'done', title: 'Done' }, { action: 'open', title: 'Open plan' }],
      });
      const update: Record<string, string> = { [field]: nowIso };
      if (kind === 'plan_check') update.needs_attention_at = nowIso;
      await supabase.from('idea_steps').update(update).eq('id', step.id);
      if (kind === 'plan_check' && step.task_id) {
        await supabase.from('tasks').update({ needs_attention_at: nowIso }).eq('id', step.task_id);
      }
      await finishRun(supabase, claim.runId, { status: 'succeeded' }, startedAt);
    } catch (error) {
      await finishRun(supabase, claim.runId, {
        status: 'failed',
        errorCode: error instanceof Error ? error.message.slice(0, 80) : 'unknown',
      }, startedAt);
    }
  };

  for (const step of upcoming ?? []) await sendStep(step as Record<string, unknown>, 'upcoming');
  for (const step of executing ?? []) await sendStep(step as Record<string, unknown>, 'execute');
  for (const step of missed ?? []) await sendStep(step as Record<string, unknown>, 'plan_check');

  return new Response(JSON.stringify({ delivered }), { status: 200 });
});
