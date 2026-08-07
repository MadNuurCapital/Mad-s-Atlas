'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { setPreferredName } from '@/features/settings/actions';

export function ProfileEditor({ preferredName }: { preferredName: string }) {
  const [name, setName] = useState(preferredName);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function save() {
    setMessage(null);
    startTransition(async () => {
      const result = await setPreferredName(name);
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setMessage('Saved');
      router.refresh();
    });
  }

  return (
    <div className="py-4">
      <label htmlFor="preferred-name" className="text-sm font-medium text-primary">
        Preferred name
      </label>
      <p className="mt-1 text-xs text-tertiary">The name Atlas uses when speaking to you.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          id="preferred-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={80}
          className="min-h-11 min-w-0 flex-1 rounded-md border border-line bg-surface-inset px-3 text-sm text-primary focus:border-accent focus:outline-none"
        />
        <button
          type="button"
          disabled={pending || name.trim().length === 0}
          onClick={save}
          className="min-h-11 rounded-md bg-surface-accent px-5 text-sm font-medium text-accent-text disabled:opacity-60"
        >
          {pending ? 'Saving…' : 'Save name'}
        </button>
      </div>
      {message ? (
        <p
          role={message === 'Saved' ? 'status' : 'alert'}
          className={`mt-2 text-xs ${message === 'Saved' ? 'text-positive' : 'text-critical'}`}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
