'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { pauseLearningFor24Hours } from './actions';

export function LearningPauseButton({ isPaused }: { isPaused: boolean }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <div className="flex items-center justify-between gap-4 border-t border-line-subtle py-4">
      <div><p className="text-sm font-medium text-primary">Pause learning for 24 hours</p><p className="mt-1 text-xs text-tertiary">Existing memories remain available. New observations are ignored while paused.</p></div>
      <button disabled={pending || isPaused} onClick={() => startTransition(async () => { await pauseLearningFor24Hours(); router.refresh(); })} className="rounded-lg border border-line px-3 py-2 text-xs text-secondary disabled:opacity-50">{isPaused ? 'Paused' : pending ? 'Pausing…' : 'Pause'}</button>
    </div>
  );
}
