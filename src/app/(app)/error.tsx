'use client';

import { AlertTriangle, RotateCw } from 'lucide-react';
import { useEffect } from 'react';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is safe correlation data; never print provider payloads or
    // secrets that may be present in an exception message.
    console.error('[atlas-ui] workspace render failed', { digest: error.digest ?? 'none' });
  }, [error.digest]);

  return (
    <div className="grid min-h-[60dvh] place-items-center px-5 py-12">
      <div className="atlas-panel atlas-corners w-full max-w-lg rounded-3xl p-7 text-center">
        <AlertTriangle aria-hidden className="mx-auto size-6 text-caution" />
        <p className="mt-4 text-2xs font-semibold tracking-[0.14em] text-caution uppercase">
          Atlas // Interrupted
        </p>
        <h1 className="font-display mt-2 text-3xl text-primary">This workspace did not finish loading.</h1>
        <p className="mt-3 text-sm leading-relaxed text-secondary">
          Your data was not changed. Retry the affected screen; if the problem continues, check the relevant connection in Settings.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mx-auto mt-6 flex min-h-11 items-center gap-2 rounded-full bg-surface-accent px-5 text-sm font-medium text-accent-text"
        >
          <RotateCw aria-hidden className="size-4" /> Retry
        </button>
      </div>
    </div>
  );
}
