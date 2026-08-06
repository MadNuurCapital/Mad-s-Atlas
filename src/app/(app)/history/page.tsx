import { Clock } from 'lucide-react';
import type { Metadata } from 'next';

import { EmptyState } from '@/components/ui/EmptyState';
import { Page, Section } from '@/components/ui/Page';
import { HistoryFilters } from '@/features/history/HistoryFilters';
import { HistoryTable } from '@/features/history/HistoryTable';
import { listActionLogs, listLoggedToolNames } from '@/lib/data/action-log';
import type { ActionStatus, OperationType } from '@/types/database';

export const metadata: Metadata = { title: 'History' };
export const dynamic = 'force-dynamic';

const STATUSES: ActionStatus[] = ['success', 'failure', 'refused', 'timeout'];
const OPERATIONS: OperationType[] = ['read', 'analyse', 'propose', 'execute', 'refuse'];

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ tool?: string; status?: string; operation?: string; days?: string }>;
}) {
  const params = await searchParams;

  const days = Number.parseInt(params.days ?? '', 10);

  // Filters are matched against a fixed vocabulary. An unrecognised value is
  // dropped rather than passed to the query.
  const status = STATUSES.includes(params.status as ActionStatus)
    ? (params.status as ActionStatus)
    : undefined;
  const operation = OPERATIONS.includes(params.operation as OperationType)
    ? (params.operation as OperationType)
    : undefined;

  const [logs, toolNames] = await Promise.all([
    listActionLogs({
      toolName: params.tool || undefined,
      status,
      operationType: operation,
      sinceDays: Number.isFinite(days) ? days : undefined,
    }),
    listLoggedToolNames(),
  ]);

  return (
    <Page
      title="History"
      description="Every action Atlas has taken. Summaries only — never keys, tokens, email bodies or audio."
    >
      <HistoryFilters toolNames={toolNames} />

      <Section>
        {logs.length === 0 ? (
          <EmptyState
            icon={Clock}
            title="No actions recorded"
            description="Once Atlas starts reading your calendar, searching mail or executing approved actions, every one appears here with its status, duration and approval trail."
          />
        ) : (
          <HistoryTable logs={logs} />
        )}
      </Section>
    </Page>
  );
}
