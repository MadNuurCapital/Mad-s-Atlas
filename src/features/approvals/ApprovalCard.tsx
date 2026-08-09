'use client';

import { useState, useTransition } from 'react';

import { approve, approveAndExecute, execute, reject } from '@/features/approvals/actions';
import { cn } from '@/lib/cn';
import { formatDateTime, formatRelative } from '@/lib/time';
import type { Approval, ApprovalStatus } from '@/types/database';

const STATUS_STYLE: Record<ApprovalStatus, string> = {
  pending: 'text-caution',
  approved: 'text-informative',
  rejected: 'text-tertiary',
  expired: 'text-tertiary',
  executed: 'text-positive',
  failed: 'text-critical',
};

/**
 * One proposed action.
 *
 * Shows the EXACT payload, not a paraphrase of it. Muhammad approves what will
 * actually run, so the literal JSON is on screen — a friendly summary alone
 * would mean approving a description rather than the action.
 */
export function ApprovalCard({ approval }: { approval: Approval }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showPayload, setShowPayload] = useState(false);

  const affected = (approval.affected_data ?? {}) as {
    records?: string[];
    external_system?: string | null;
  };

  const expired = new Date(approval.expires_at) < new Date();
  const isPending = approval.status === 'pending' && !expired;
  const isApproved = approval.status === 'approved' && !expired;
  const isCompoundIdeaAction = approval.action_type === 'ideas.execute_plan' || approval.action_type === 'ideas.execute_delete';

  function run(action: (fd: FormData) => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    const formData = new FormData();
    formData.set('id', approval.id);
    startTransition(async () => {
      const result = await action(formData);
      if (!result.ok && result.error) setError(result.error);
    });
  }

  return (
    <article className="rounded-lg border border-line-subtle bg-surface-raised p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-primary">{approval.title}</h3>
          <p className="mt-1 text-sm leading-relaxed text-secondary">{approval.reason}</p>
        </div>
        <span className={cn('text-2xs font-medium capitalize', STATUS_STYLE[approval.status])}>
          {expired && approval.status === 'pending' ? 'expired' : approval.status}
        </span>
      </div>

      <dl className="mt-4 grid gap-2 text-2xs sm:grid-cols-2">
        <div>
          <dt className="text-tertiary">Action</dt>
          <dd className="font-mono text-secondary">{approval.action_type}</dd>
        </div>
        <div>
          <dt className="text-tertiary">External system</dt>
          <dd className="text-secondary">{affected.external_system ?? 'None'}</dd>
        </div>
        <div>
          <dt className="text-tertiary">Requested</dt>
          <dd className="text-secondary">{formatRelative(new Date(approval.requested_at))}</dd>
        </div>
        <div>
          <dt className="text-tertiary">{expired ? 'Expired' : 'Expires'}</dt>
          <dd className="text-secondary">{formatDateTime(new Date(approval.expires_at))}</dd>
        </div>
      </dl>

      {affected.records && affected.records.length > 0 ? (
        <p className="mt-3 text-2xs text-tertiary">
          Affects: {affected.records.join(', ')}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => setShowPayload((v) => !v)}
        className="mt-4 text-2xs text-accent-text underline underline-offset-2"
        aria-expanded={showPayload}
      >
        {showPayload ? 'Hide' : 'Show'} exactly what will run
      </button>

      {showPayload ? (
        <pre className="mt-2 overflow-x-auto rounded-md bg-surface-inset p-3 font-mono text-2xs text-secondary">
          {JSON.stringify(approval.proposed_payload, null, 2)}
        </pre>
      ) : null}

      {isPending || isApproved ? (
        <div className="mt-5 flex flex-wrap gap-2">
          {isPending ? (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(isCompoundIdeaAction ? approveAndExecute : approve)}
                className="min-h-11 rounded-md bg-surface-accent px-4 text-sm font-medium text-accent-text transition-colors hover:bg-forest-700 disabled:opacity-60"
              >
                {pending
                  ? 'Running…'
                  : approval.action_type === 'ideas.execute_plan'
                    ? 'Approve Plan'
                    : approval.action_type === 'ideas.execute_delete'
                      ? 'Approve deletion'
                      : 'Approve'}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(reject)}
                className="min-h-11 rounded-md border border-line px-4 text-sm text-secondary transition-colors hover:text-primary disabled:opacity-60"
              >
                Reject
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(execute)}
              className="min-h-11 rounded-md bg-surface-accent px-4 text-sm font-medium text-accent-text transition-colors hover:bg-forest-700 disabled:opacity-60"
            >
              {pending ? 'Running…' : 'Run it now'}
            </button>
          )}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-sm text-critical">
          {error}
        </p>
      ) : null}
    </article>
  );
}
