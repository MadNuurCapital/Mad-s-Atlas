import { BellRing } from 'lucide-react';
import type { Metadata } from 'next';

import { EmptyState } from '@/components/ui/EmptyState';
import { Card, Page, Section } from '@/components/ui/Page';
import { AddReminder } from '@/features/reminders/AddReminder';
import { bucketReminders, listReminders } from '@/lib/data/reminders';
import { describeRecurrence } from '@/lib/scheduling/recurrence';
import { formatDateTime } from '@/lib/time';
import type { Reminder } from '@/types/database';

export const metadata: Metadata = { title: 'Reminders' };
export const dynamic = 'force-dynamic';

function ReminderCard({ reminder }: { reminder: Reminder }) {
  const at = reminder.next_trigger_at ?? reminder.remind_at;

  return (
    <Card as="li">
      <p className="text-sm font-medium text-primary">{reminder.title}</p>
      {reminder.description ? (
        <p className="mt-1 text-sm leading-relaxed text-tertiary">{reminder.description}</p>
      ) : null}

      <p className="mt-3 text-2xs text-secondary">
        {formatDateTime(new Date(at), reminder.timezone)}
        {/* The zone is always shown. A reminder set in one zone and read in
            another is exactly where confusion starts. */}
        <span className="text-tertiary"> · {reminder.timezone}</span>
      </p>

      {reminder.recurrence_rule ? (
        <p className="mt-1 text-2xs text-accent-text">
          {describeRecurrence(reminder.recurrence_rule)}
        </p>
      ) : null}
    </Card>
  );
}

export default async function RemindersPage() {
  const reminders = await listReminders();
  const buckets = bucketReminders(reminders);

  if (reminders.length === 0) {
    return (
      <Page title="Reminders" description="One-off and recurring, in your own timezone.">
        <AddReminder />
        <EmptyState
          icon={BellRing}
          title="No reminders set"
          description="Reminders live in your own database. Browser notifications stay off until you grant permission — a setting that was on but silently did nothing would be dishonest."
        />
      </Page>
    );
  }

  const sections: Array<[label: string, items: Reminder[]]> = [
    ['Due now', buckets.due],
    ['Upcoming', buckets.upcoming],
    ['Recurring', buckets.recurring],
    ['Inactive', buckets.inactive],
  ];

  return (
    <Page
      title="Reminders"
      description={`${reminders.length} reminder${reminders.length === 1 ? '' : 's'}, shown in the timezone each was set in.`}
    >
      <AddReminder />
      {sections.map(([label, items]) =>
        items.length === 0 ? null : (
          <Section key={label} title={label}>
            <ul className="grid gap-3 sm:grid-cols-2">
              {items.map((reminder) => (
                <ReminderCard key={reminder.id} reminder={reminder} />
              ))}
            </ul>
          </Section>
        ),
      )}
    </Page>
  );
}
