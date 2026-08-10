'use client';

import { CalendarClock, Check, Circle, CircleCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { completeStepAction } from '@/features/ideas/actions';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/time';
import type { IdeaStep } from '@/types/database';

export function IdeaSteps({ ideaId, steps }: { ideaId: string; steps: IdeaStep[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function complete(stepId: string) {
    const formData = new FormData();
    formData.set('ideaId', ideaId);
    formData.set('stepId', stepId);
    startTransition(async () => {
      setError(null);
      const result = await completeStepAction(formData);
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  }

  return (
    <div>
      <ol className="space-y-3">
        {steps.map((step, index) => {
          const done = step.status === 'completed' || step.status === 'skipped';
          return (
            <li key={step.id} className={cn('rounded-xl border border-line-subtle bg-surface-raised p-4', step.needs_attention_at && 'border-caution/50')}>
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  disabled={pending || done}
                  onClick={() => complete(step.id)}
                  className="grid size-11 shrink-0 place-items-center rounded-full text-tertiary hover:bg-surface-overlay hover:text-positive disabled:opacity-60"
                  aria-label={done ? `${step.title} completed` : `Mark ${step.title} done`}
                >
                  {step.status === 'completed' ? <CircleCheck aria-hidden className="size-5 text-positive" /> : done ? <Check aria-hidden className="size-5" /> : <Circle aria-hidden className="size-5" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-2xs font-medium text-tertiary">{index + 1}</span>
                    <p className={cn('text-sm font-medium', done ? 'text-tertiary line-through' : 'text-primary')}>{step.title}</p>
                    {step.needs_attention_at ? <span className="rounded-full bg-caution/10 px-2 py-0.5 text-2xs text-caution">Needs attention</span> : null}
                  </div>
                  {step.description ? <p className="mt-1 text-sm leading-relaxed text-tertiary">{step.description}</p> : null}
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-secondary">
                    <CalendarClock aria-hidden className="size-3.5" />
                    {step.scheduled_start ? formatDateTime(new Date(step.scheduled_start)) : 'Not scheduled'}
                    <span className="text-tertiary">· {step.duration_minutes} min</span>
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {error ? <p role="alert" className="mt-3 text-sm text-critical">{error}</p> : null}
    </div>
  );
}
