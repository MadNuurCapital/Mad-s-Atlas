import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { nextOccurrence } from '@/lib/scheduling/recurrence';
import type { Reminder } from '@/types/database';

/**
 * Reminder reads and writes.
 *
 * Like every data module here, queries go through the request-scoped client so
 * Row Level Security applies and `user_id` never has to be passed in.
 *
 * Reminders are Level 1 — internal, reversible, and visible. Mirroring one to
 * Google Calendar is an external write and therefore Level 2, handled through
 * the approval flow rather than here.
 */

export type ReminderBuckets = {
  due: Reminder[];
  upcoming: Reminder[];
  recurring: Reminder[];
  inactive: Reminder[];
};

export async function listReminders(): Promise<Reminder[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('reminders')
    .select('*')
    .order('next_trigger_at', { ascending: true, nullsFirst: false })
    .order('remind_at', { ascending: true });

  if (error) throw new Error(`Could not load reminders (${error.code ?? 'unknown'})`);
  return (data ?? []) as Reminder[];
}

/** One snapshot, partitioned — not four queries that could disagree. */
export function bucketReminders(reminders: Reminder[], now = new Date()): ReminderBuckets {
  const buckets: ReminderBuckets = { due: [], upcoming: [], recurring: [], inactive: [] };

  for (const reminder of reminders) {
    if (reminder.status === 'disabled' || reminder.status === 'completed') {
      buckets.inactive.push(reminder);
      continue;
    }

    if (reminder.recurrence_rule) {
      buckets.recurring.push(reminder);
      continue;
    }

    const at = new Date(reminder.next_trigger_at ?? reminder.remind_at);
    if (at.getTime() <= now.getTime()) buckets.due.push(reminder);
    else buckets.upcoming.push(reminder);
  }

  return buckets;
}

export type CreateReminderInput = {
  title: string;
  description?: string;
  remindAt: string;
  recurrenceRule?: string;
  timezone?: string;
  deliveryChannel?: 'push' | 'in_app' | 'calendar';
};

export async function createReminder(input: CreateReminderInput): Promise<Reminder> {
  const supabase = await createClient();

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('Not signed in.');

  const timezone = input.timezone ?? 'Asia/Singapore';

  const seriesStart = new Date(input.remindAt);

  // For a recurring reminder the FIRST trigger is the series start itself.
  // Later occurrences are computed by the cron job from the same rule, in the
  // reminder's OWN timezone — "every weekday at 9am" means 9am where Muhammad
  // is, not where the server happens to run.
  //
  // A rule that is in the past still gets validated here: nextOccurrence
  // returning null means the rule never fires again, which is worth catching
  // at creation rather than discovering through silence.
  let nextTrigger = seriesStart;

  if (input.recurrenceRule && seriesStart.getTime() < Date.now()) {
    const upcoming = nextOccurrence(input.recurrenceRule, seriesStart, new Date(), timezone);
    if (!upcoming) {
      throw new Error('That recurrence rule has no future occurrences.');
    }
    nextTrigger = upcoming;
  }

  const { data, error } = await supabase
    .from('reminders')
    .insert({
      user_id: auth.user.id,
      title: input.title,
      description: input.description ?? null,
      remind_at: input.remindAt,
      recurrence_rule: input.recurrenceRule ?? null,
      timezone,
      delivery_channel: input.deliveryChannel ?? 'in_app',
      next_trigger_at: nextTrigger.toISOString(),
      status: 'scheduled',
    })
    .select()
    .single();

  if (error) throw new Error(`Could not create the reminder (${error.code ?? 'unknown'})`);
  return data as Reminder;
}

/** Stop a reminder firing without deleting its history. */
export async function disableReminder(id: string): Promise<void> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('reminders')
    .update({ status: 'disabled' })
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error || !data) throw new Error(`Could not disable the reminder (${error?.code ?? 'not_found'})`);
}
