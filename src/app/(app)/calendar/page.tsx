import { CalendarDays } from 'lucide-react';
import type { Metadata } from 'next';

import { EmptyState } from '@/components/ui/EmptyState';
import { Page } from '@/components/ui/Page';

export const metadata: Metadata = { title: 'Calendar' };

export default function CalendarPage() {
  return (
    <Page
      title="Calendar"
      description="Today, upcoming, meeting preparation and proposed changes. Every calendar write requires your approval."
    >
      <EmptyState
        icon={CalendarDays}
        title="Google Calendar is not connected"
        description="Connect Google in Settings to see your agenda. Reads happen automatically; creating or updating an event always waits for your approval."
      />
    </Page>
  );
}
