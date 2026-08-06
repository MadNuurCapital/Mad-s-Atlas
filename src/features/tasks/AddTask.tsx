'use client';

import { Plus } from 'lucide-react';
import { useRef, useState, useTransition } from 'react';

import { createTask } from '@/features/tasks/actions';
import type { TaskPriority } from '@/types/database';

const PRIORITIES: TaskPriority[] = ['low', 'normal', 'high', 'critical'];

export function AddTask() {
  const formRef = useRef<HTMLFormElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createTask(formData);
      if (result.ok) {
        formRef.current?.reset();
        setExpanded(false);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form ref={formRef} action={submit} className="mb-6">
      <div className="flex gap-2">
        <input
          name="title"
          required
          maxLength={200}
          placeholder="What needs doing?"
          onFocus={() => setExpanded(true)}
          className="min-h-11 flex-1 rounded-md border border-line bg-surface-raised px-3 text-sm text-primary placeholder:text-tertiary focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending}
          className="grid min-h-11 min-w-11 place-items-center rounded-md bg-surface-accent px-4 text-sm font-medium text-accent-text transition-colors hover:bg-forest-700 disabled:opacity-60"
        >
          {pending ? '…' : <Plus aria-hidden className="size-4" />}
          <span className="sr-only">Add task</span>
        </button>
      </div>

      {expanded ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="text-2xs text-tertiary">
            Due
            <input
              type="datetime-local"
              name="due_at_local"
              onChange={(event) => {
                // Convert the local wall-clock reading to a real instant. The
                // browser gives no zone, so an unconverted value would be
                // interpreted as UTC and land eight hours out in Singapore.
                const hidden = event.currentTarget.form?.elements.namedItem('due_at');
                if (hidden instanceof HTMLInputElement) {
                  hidden.value = event.currentTarget.value
                    ? new Date(event.currentTarget.value).toISOString()
                    : '';
                }
              }}
              className="mt-1 block min-h-11 w-full rounded-md border border-line bg-surface-raised px-3 text-sm text-primary focus:border-accent focus:outline-none"
            />
            <input type="hidden" name="due_at" />
          </label>

          <label className="text-2xs text-tertiary">
            Priority
            <select
              name="priority"
              defaultValue="normal"
              className="mt-1 block min-h-11 w-full rounded-md border border-line bg-surface-raised px-3 text-sm text-primary capitalize focus:border-accent focus:outline-none"
            >
              {PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-sm text-critical">
          {error}
        </p>
      ) : null}
    </form>
  );
}
