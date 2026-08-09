'use client';

import { Archive, Check, RefreshCw, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  archiveIdeaAction,
  completeIdeaAction,
  proposeDeleteAction,
  proposePlanAction,
  restoreIdeaAction,
  runIdeaCommandAction,
} from '@/features/ideas/actions';
import type { IdeaStatus } from '@/types/database';

type Result = { ok: true; message: string; approvalId?: string; requiresDeleteReview?: boolean } | { ok: false; error: string };

function resultText(result: Result): string {
  return result.ok ? result.message : result.error;
}

export function IdeaPlanButton({ ideaId, hasPlan }: { ideaId: string; hasPlan: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function run() {
    const formData = new FormData();
    formData.set('ideaId', ideaId);
    if (hasPlan) formData.set('revisionInstruction', 'Re-plan the unfinished work around my current Calendar commitments.');
    startTransition(async () => {
      const result = await proposePlanAction(formData);
      setMessage(resultText(result));
      router.refresh();
    });
  }

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={run}
        className="flex min-h-11 items-center gap-2 rounded-full bg-surface-accent px-5 text-sm font-medium text-accent-text disabled:opacity-60"
      >
        {hasPlan ? <RefreshCw aria-hidden className="size-4" /> : <Sparkles aria-hidden className="size-4" />}
        {pending ? 'Checking calendar…' : hasPlan ? 'Re-plan' : 'Turn into a plan'}
      </button>
      {message ? <p className="mt-2 max-w-sm text-xs text-secondary">{message}</p> : null}
    </div>
  );
}

export function IdeaCommandBox({ ideaId }: { ideaId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function submit(formData: FormData) {
    formData.set('ideaId', ideaId);
    startTransition(async () => {
      const result = await runIdeaCommandAction(formData);
      setMessage(resultText(result));
      if (result.ok && result.requiresDeleteReview) {
        document.getElementById('idea-delete')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      router.refresh();
    });
  }

  return (
    <form id="idea-command" action={submit} className="atlas-panel rounded-2xl p-4 sm:p-5">
      <label className="text-xs font-semibold tracking-[0.13em] text-tertiary uppercase" htmlFor="idea-command-input">
        Update this plan naturally
      </label>
      <div className="mt-3 flex gap-2">
        <input
          id="idea-command-input"
          name="command"
          required
          maxLength={4000}
          placeholder="Move this to tomorrow, make it simpler, add a note…"
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface-inset px-3 text-sm text-primary outline-none placeholder:text-tertiary focus:border-accent"
        />
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-xl bg-surface-accent px-4 text-sm font-medium text-accent-text disabled:opacity-60"
        >
          {pending ? 'Updating…' : 'Ask Atlas'}
        </button>
      </div>
      {message ? <p aria-live="polite" className="mt-2 text-xs text-secondary">{message}</p> : null}
    </form>
  );
}

export function IdeaLifecycleActions({ ideaId, status }: { ideaId: string; status: IdeaStatus }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function run(action: (formData: FormData) => Promise<Result>) {
    const formData = new FormData();
    formData.set('ideaId', ideaId);
    startTransition(async () => {
      const result = await action(formData);
      setMessage(resultText(result));
      router.refresh();
    });
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {status !== 'completed' && status !== 'archived' ? (
          <button type="button" disabled={pending} onClick={() => run(completeIdeaAction)} className="flex min-h-11 items-center gap-2 rounded-xl border border-line px-4 text-sm text-secondary hover:text-primary disabled:opacity-50">
            <Check aria-hidden className="size-4" /> Complete plan
          </button>
        ) : null}
        {status === 'archived' ? (
          <button type="button" disabled={pending} onClick={() => run(restoreIdeaAction)} className="flex min-h-11 items-center gap-2 rounded-xl border border-line px-4 text-sm text-secondary hover:text-primary disabled:opacity-50">
            <RotateCcw aria-hidden className="size-4" /> Restore
          </button>
        ) : (
          <button type="button" disabled={pending} onClick={() => run(archiveIdeaAction)} className="flex min-h-11 items-center gap-2 rounded-xl border border-line px-4 text-sm text-secondary hover:text-primary disabled:opacity-50">
            <Archive aria-hidden className="size-4" /> Archive
          </button>
        )}
      </div>
      {message ? <p className="mt-2 text-xs text-secondary">{message}</p> : null}
    </div>
  );
}

export function DeleteIdeaPanel({
  ideaId,
  linkedTasks,
  linkedReminders,
  linkedCalendarEvents,
}: {
  ideaId: string;
  linkedTasks: number;
  linkedReminders: number;
  linkedCalendarEvents: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function submit(formData: FormData) {
    if (!window.confirm('Prepare permanent deletion of this Idea? You will still review the exact payload before anything is deleted.')) return;
    formData.set('ideaId', ideaId);
    startTransition(async () => {
      const result = await proposeDeleteAction(formData);
      setMessage(resultText(result));
      router.refresh();
    });
  }

  return (
    <details id="idea-delete" className="rounded-2xl border border-critical/25 bg-critical/5 p-4">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-critical">
        <Trash2 aria-hidden className="size-4" /> Delete this Idea
      </summary>
      <form action={submit} className="mt-4 space-y-3">
        <p className="text-sm leading-relaxed text-secondary">
          The Idea itself will be permanently deleted after approval. Choose whether its linked items should also be removed.
        </p>
        <label className="flex min-h-11 items-center gap-3 text-sm text-secondary">
          <input type="checkbox" name="deleteLinkedTasks" className="size-4 accent-[var(--color-gold-400)]" />
          Remove {linkedTasks} linked task{linkedTasks === 1 ? '' : 's'}
        </label>
        <label className="flex min-h-11 items-center gap-3 text-sm text-secondary">
          <input type="checkbox" name="deleteLinkedReminders" className="size-4 accent-[var(--color-gold-400)]" />
          Remove {linkedReminders} linked reminder{linkedReminders === 1 ? '' : 's'}
        </label>
        <label className="flex min-h-11 items-center gap-3 text-sm text-secondary">
          <input type="checkbox" name="deleteLinkedCalendarEvents" className="size-4 accent-[var(--color-gold-400)]" />
          Remove {linkedCalendarEvents} linked Google Calendar event{linkedCalendarEvents === 1 ? '' : 's'}
        </label>
        <button type="submit" disabled={pending} className="min-h-11 rounded-xl border border-critical/40 px-4 text-sm font-medium text-critical disabled:opacity-50">
          {pending ? 'Preparing review…' : 'Review deletion'}
        </button>
        {message ? <p className="text-xs text-secondary">{message}</p> : null}
      </form>
    </details>
  );
}
