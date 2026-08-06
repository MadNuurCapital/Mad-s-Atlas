import { Clock } from 'lucide-react';
import type { Metadata } from 'next';

import { EmptyState } from '@/components/ui/EmptyState';
import { Page } from '@/components/ui/Page';

export const metadata: Metadata = { title: 'History' };

export default function HistoryPage() {
  return (
    <Page
      title="History"
      description="Every action Atlas has taken, with its status, duration and approval trail."
    >
      <EmptyState
        icon={Clock}
        title="No actions recorded"
        description="The audit log holds summaries only — never keys, tokens, email bodies or audio. Filter by date, tool, status and action type once there is something to see."
      />
    </Page>
  );
}
