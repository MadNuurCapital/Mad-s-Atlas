'use client';

import { Trash2 } from 'lucide-react';
import { useState, useTransition } from 'react';

import { removeReminder } from '@/features/reminders/actions';

export function RemoveReminderButton({ id, title }: { id: string; title: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function remove() {
    if (!window.confirm(`Remove “${title}”? This cannot be undone.`)) return;

    setError(null);
    const formData = new FormData();
    formData.set('id', id);

    startTransition(async () => {
      const result = await removeReminder(formData);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="shrink-0 text-right">
      <button
        type="button"
        disabled={pending}
        onClick={remove}
        className="grid size-11 place-items-center rounded-md text-tertiary transition-colors hover:bg-surface-overlay hover:text-critical disabled:opacity-50"
        aria-label={`Remove reminder: ${title}`}
        title="Remove reminder"
      >
        <Trash2 aria-hidden className="size-4" />
      </button>
      {error ? <p role="alert" className="mt-1 max-w-48 text-2xs text-critical">{error}</p> : null}
    </div>
  );
}
