'use client';

import { BellPlus } from 'lucide-react';
import { useRef, useState, useTransition } from 'react';

import { addReminder } from '@/features/reminders/actions';

export function AddReminder() {
  const formRef = useRef<HTMLFormElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(formData: FormData) {
    setError(null);
    formData.set(
      'timezone',
      Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Singapore',
    );
    startTransition(async () => {
      const result = await addReminder(formData);
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
          placeholder="What should Atlas remind you about?"
          onFocus={() => setExpanded(true)}
          className="min-h-11 flex-1 rounded-md border border-line bg-surface-raised px-3 text-sm text-primary placeholder:text-tertiary focus:border-accent focus:outline-none"
        />
        <button type="submit" disabled={pending} className="grid min-h-11 min-w-11 place-items-center rounded-md bg-surface-accent px-4 text-accent-text transition-colors hover:bg-forest-700 disabled:opacity-60">
          {pending ? '…' : <BellPlus aria-hidden className="size-4" />}
          <span className="sr-only">Add reminder</span>
        </button>
      </div>

      {expanded ? (
        <label className="mt-2 block text-2xs text-tertiary">
          Remind me at
          <input
            type="datetime-local"
            name="remind_at_local"
            required
            onChange={(event) => {
              const hidden = event.currentTarget.form?.elements.namedItem('remind_at');
              if (hidden instanceof HTMLInputElement) {
                hidden.value = event.currentTarget.value ? new Date(event.currentTarget.value).toISOString() : '';
              }
            }}
            className="mt-1 block min-h-11 w-full rounded-md border border-line bg-surface-raised px-3 text-sm text-primary focus:border-accent focus:outline-none sm:max-w-sm"
          />
          <input type="hidden" name="remind_at" />
        </label>
      ) : null}

      {error ? <p role="alert" className="mt-2 text-sm text-critical">{error}</p> : null}
    </form>
  );
}
