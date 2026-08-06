'use client';

import { Check, Trash2, X } from 'lucide-react';
import { useTransition } from 'react';

import { confirmMemory, deleteMemory, rejectSuggestion } from '@/features/memory/actions';
import { cn } from '@/lib/cn';
import { formatRelative } from '@/lib/time';
import type { Memory, Sensitivity } from '@/types/database';

const SENSITIVITY_LABEL: Record<Sensitivity, string | null> = {
  normal: null,
  personal: 'Personal',
  sensitive: 'Sensitive',
  highly_sensitive: 'Highly sensitive',
};

const SENSITIVITY_STYLE: Record<Sensitivity, string> = {
  normal: '',
  personal: 'text-tertiary',
  sensitive: 'text-caution',
  highly_sensitive: 'text-critical',
};

export function MemoryList({
  memories,
  mode,
}: {
  memories: Memory[];
  /**
   * `review` renders the confirm/dismiss pair for suggestions. Confirmation is
   * always an explicit act — nothing here promotes a memory automatically.
   */
  mode: 'review' | 'confirmed';
}) {
  const [pending, startTransition] = useTransition();

  function act(action: (fd: FormData) => Promise<unknown>, id: string) {
    const formData = new FormData();
    formData.set('id', id);
    startTransition(() => {
      void action(formData);
    });
  }

  return (
    <ul className="space-y-3">
      {memories.map((memory) => {
        const sensitivityLabel = SENSITIVITY_LABEL[memory.sensitivity];

        return (
          <li
            key={memory.id}
            className={cn(
              'rounded-lg border bg-surface-raised p-4',
              mode === 'review' ? 'border-accent/30' : 'border-line-subtle',
            )}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-primary">{memory.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-secondary">{memory.content}</p>

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-tertiary">
                  <span className="capitalize">{memory.category.replace('_', ' ')}</span>
                  {sensitivityLabel ? (
                    <span className={SENSITIVITY_STYLE[memory.sensitivity]}>
                      {sensitivityLabel}
                    </span>
                  ) : null}
                  {memory.confirmed_at ? (
                    <span>Confirmed {formatRelative(new Date(memory.confirmed_at))}</span>
                  ) : null}
                  {memory.expires_at ? (
                    <span>Expires {formatRelative(new Date(memory.expires_at))}</span>
                  ) : null}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {mode === 'review' ? (
                  <>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => act(confirmMemory, memory.id)}
                      className="grid size-11 place-items-center rounded-md text-tertiary transition-colors hover:bg-surface-overlay hover:text-positive disabled:opacity-50"
                      aria-label={`Confirm: ${memory.title}`}
                    >
                      <Check aria-hidden className="size-4" />
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => act(rejectSuggestion, memory.id)}
                      className="grid size-11 place-items-center rounded-md text-tertiary transition-colors hover:bg-surface-overlay hover:text-critical disabled:opacity-50"
                      aria-label={`Dismiss: ${memory.title}`}
                    >
                      <X aria-hidden className="size-4" />
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => act(deleteMemory, memory.id)}
                    className="grid size-11 place-items-center rounded-md text-tertiary transition-colors hover:bg-surface-overlay hover:text-critical disabled:opacity-50"
                    aria-label={`Delete: ${memory.title}`}
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </button>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
