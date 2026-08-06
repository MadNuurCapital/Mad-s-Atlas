import { ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';

import { EmptyState } from '@/components/ui/EmptyState';
import { Page } from '@/components/ui/Page';

export const metadata: Metadata = { title: 'Approvals' };

export default function ApprovalsPage() {
  return (
    <Page
      title="Approvals"
      description="Every consequential action waits here first. You see the exact payload before anything happens."
    >
      <EmptyState
        icon={ShieldCheck}
        title="Nothing awaiting approval"
        description="Creating a Gmail draft, adding a calendar event, deleting a task or saving sensitive memory all appear here for your decision. An approved action executes exactly once."
      />
    </Page>
  );
}
