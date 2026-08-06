import { Sun } from 'lucide-react';
import type { Metadata } from 'next';

import { EmptyState } from '@/components/ui/EmptyState';
import { Card, Page, Section } from '@/components/ui/Page';
import { ATLAS_DEFAULT_TIMEZONE, formatLongDate } from '@/lib/time';

export const metadata: Metadata = { title: 'Today' };

export default function TodayPage() {
  const now = new Date();

  return (
    <Page
      title="Today"
      description={`${formatLongDate(now, ATLAS_DEFAULT_TIMEZONE)} · Singapore`}
    >
      <Section title="Primary priority">
        <Card>
          <p className="text-sm leading-relaxed text-secondary">
            Atlas recommends your most important next action here once your calendar, tasks and
            email are connected.
          </p>
        </Card>
      </Section>

      <Section title="Daily briefing">
        <EmptyState
          icon={Sun}
          title="No briefing yet"
          description="Your briefing is generated at 9:00 am Singapore time once scheduled jobs are running. It covers your calendar, reminders, overdue tasks, important email, pending approvals and five intelligence stories."
        />
      </Section>
    </Page>
  );
}
