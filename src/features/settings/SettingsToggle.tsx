'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import type { SettingsActionResult } from '@/features/settings/actions';
import { cn } from '@/lib/cn';

export function SettingsToggle({
  label,
  description,
  enabled,
  action,
}: {
  label: string;
  description: string;
  enabled: boolean;
  action: (enabled: boolean) => Promise<SettingsActionResult>;
}) {
  const [value, setValue] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function toggle() {
    const next = !value;
    setError(null);
    setValue(next);
    startTransition(async () => {
      const result = await action(next);
      if (!result.ok) {
        setValue(!next);
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="border-b border-line-subtle py-4 last:border-0">
      <div className="flex items-center justify-between gap-5">
        <div>
          <p className="text-sm font-medium text-primary">{label}</p>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-tertiary">{description}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={value}
          aria-label={`${value ? 'Disable' : 'Enable'} ${label}`}
          disabled={pending}
          onClick={toggle}
          className={cn(
            'relative h-7 w-12 shrink-0 rounded-full border transition-colors disabled:opacity-60',
            value ? 'border-accent/40 bg-surface-accent' : 'border-line bg-surface-inset',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'absolute top-1 size-[1.1rem] rounded-full transition-all',
              value ? 'left-6 bg-accent' : 'left-1 bg-tertiary',
            )}
          />
        </button>
      </div>
      {error ? <p role="alert" className="mt-2 text-xs text-critical">{error}</p> : null}
    </div>
  );
}
