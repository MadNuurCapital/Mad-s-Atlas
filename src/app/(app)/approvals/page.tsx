import { ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';

import { EmptyState } from '@/components/ui/EmptyState';
import { Page, Section } from '@/components/ui/Page';
import { ApprovalCard } from '@/features/approvals/ApprovalCard';
import { listApprovals, partitionApprovals } from '@/lib/data/approvals';

export const metadata: Metadata = { title: 'Approvals' };
export const dynamic = 'force-dynamic';

export default async function ApprovalsPage() {
  const { pending, readyToRun, settled } = partitionApprovals(await listApprovals());

  return (
    <Page
      title="Approvals"
      description="Every consequential action waits here. You see the exact payload before anything happens, and an approved action runs exactly once."
    >
      {readyToRun.length > 0 ? (
        <Section title="Approved — ready to run">
          <div className="space-y-3">
            {readyToRun.map((approval) => (
              <ApprovalCard key={approval.id} approval={approval} />
            ))}
          </div>
        </Section>
      ) : null}

      <Section title="Awaiting your decision">
        {pending.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="Nothing awaiting approval"
            description="Creating a Gmail draft, adding a calendar event, deleting a task or saving sensitive memory all appear here first."
          />
        ) : (
          <div className="space-y-3">
            {pending.map((approval) => (
              <ApprovalCard key={approval.id} approval={approval} />
            ))}
          </div>
        )}
      </Section>

      {settled.length > 0 ? (
        <Section title="Settled">
          <div className="space-y-3">
            {settled.slice(0, 20).map((approval) => (
              <ApprovalCard key={approval.id} approval={approval} />
            ))}
          </div>
        </Section>
      ) : null}
    </Page>
  );
}
