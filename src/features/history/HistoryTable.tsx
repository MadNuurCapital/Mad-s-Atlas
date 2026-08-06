import { cn } from '@/lib/cn';
import { formatDateTime, formatRelative } from '@/lib/time';
import type { ActionLog, ActionStatus } from '@/types/database';

const STATUS_STYLES: Record<ActionStatus, string> = {
  success: 'text-positive',
  failure: 'text-critical',
  refused: 'text-caution',
  timeout: 'text-caution',
};

const STATUS_LABELS: Record<ActionStatus, string> = {
  success: 'Succeeded',
  failure: 'Failed',
  refused: 'Refused',
  timeout: 'Timed out',
};

export function HistoryTable({ logs }: { logs: ActionLog[] }) {
  return (
    // Wide content scrolls inside its own container; the page body never
    // scrolls sideways.
    <div className="overflow-x-auto rounded-lg border border-line-subtle bg-surface-raised">
      <table className="w-full min-w-[44rem] text-sm">
        <caption className="sr-only">Actions Atlas has taken, most recent first</caption>
        <thead>
          <tr className="border-b border-line-subtle text-left text-2xs tracking-wide text-tertiary uppercase">
            <th scope="col" className="px-4 py-3 font-medium">Time</th>
            <th scope="col" className="px-4 py-3 font-medium">Tool</th>
            <th scope="col" className="px-4 py-3 font-medium">Action</th>
            <th scope="col" className="px-4 py-3 font-medium">Status</th>
            <th scope="col" className="px-4 py-3 text-right font-medium">Duration</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line-subtle">
          {logs.map((log) => {
            const at = new Date(log.created_at);

            return (
              <tr key={log.id} className="align-top">
                <td className="px-4 py-3 whitespace-nowrap text-tertiary">
                  <time dateTime={log.created_at} title={formatDateTime(at)}>
                    {formatRelative(at)}
                  </time>
                </td>
                <td className="px-4 py-3 font-mono text-2xs whitespace-nowrap text-secondary">
                  {log.tool_name}
                </td>
                <td className="px-4 py-3 text-primary">
                  {log.action_summary}
                  {log.approval_id ? (
                    <span className="ml-2 rounded-full bg-accent-muted px-2 py-0.5 text-2xs text-accent-text">
                      approved
                    </span>
                  ) : null}
                  {log.error_code ? (
                    <span className="mt-1 block font-mono text-2xs text-critical">
                      {log.error_code}
                    </span>
                  ) : null}
                </td>
                <td className={cn('px-4 py-3 whitespace-nowrap', STATUS_STYLES[log.status])}>
                  {STATUS_LABELS[log.status]}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap text-tertiary tabular-nums">
                  {log.duration_ms === null ? '—' : `${log.duration_ms} ms`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
