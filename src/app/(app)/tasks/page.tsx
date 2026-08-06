import { CheckSquare } from 'lucide-react';
import type { Metadata } from 'next';

import { EmptyState } from '@/components/ui/EmptyState';
import { Page } from '@/components/ui/Page';

export const metadata: Metadata = { title: 'Tasks' };

export default function TasksPage() {
  return (
    <Page title="Tasks" description="Inbox, today, upcoming, overdue and completed.">
      <EmptyState
        icon={CheckSquare}
        title="No tasks yet"
        description="Capture tasks by voice or by hand. They live in your own database, not in any external system."
      />
    </Page>
  );
}
