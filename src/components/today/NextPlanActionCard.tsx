'use client';

import { ArrowRight, CalendarClock, Check } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { completeStepAction } from '@/features/ideas/actions';
import { formatDateTime } from '@/lib/time';
import type { Idea, IdeaStep } from '@/types/database';

export function NextPlanActionCard({ idea, step }: { idea: Idea; step: IdeaStep }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function complete() {
    const formData = new FormData();
    formData.set('ideaId', idea.id);
    formData.set('stepId', step.id);
    startTransition(async () => {
      const result = await completeStepAction(formData);
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  }

  return (
    <section className="atlas-panel atlas-corners mt-6 rounded-2xl p-5" aria-labelledby="today-next-plan-action">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-2xs font-semibold tracking-[0.14em] text-accent-text uppercase">Next plan action</p>
          <h2 id="today-next-plan-action" className="mt-1 text-base font-medium text-primary">{step.title}</h2>
          <p className="mt-1 text-xs text-tertiary">{idea.title}</p>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-secondary">
            <CalendarClock aria-hidden className="size-3.5 text-accent-text" />
            {step.scheduled_start ? formatDateTime(new Date(step.scheduled_start)) : 'Not scheduled'} · {step.duration_minutes} min
            {step.needs_attention_at ? <span className="ml-1 text-caution">· Needs attention</span> : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={pending} onClick={complete} className="flex min-h-11 items-center gap-2 rounded-xl bg-surface-accent px-4 text-sm font-medium text-accent-text disabled:opacity-60">
            <Check aria-hidden className="size-4" /> Done
          </button>
          <Link href={`/ideas/${idea.id}`} className="flex min-h-11 items-center gap-2 rounded-xl border border-line px-4 text-sm text-secondary hover:text-primary">Open plan <ArrowRight aria-hidden className="size-4" /></Link>
          <Link href={`/ideas/${idea.id}#idea-command`} className="flex min-h-11 items-center rounded-xl border border-line px-4 text-sm text-secondary hover:text-primary">Reschedule</Link>
        </div>
      </div>
      {error ? <p role="alert" className="mt-3 text-sm text-critical">{error}</p> : null}
    </section>
  );
}
