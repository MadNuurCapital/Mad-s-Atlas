'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { resetInferredLearning, reviewLearningItem, revertAdaptation } from './actions';

const buttonClass = 'rounded-lg border border-line px-3 py-1.5 text-xs text-secondary transition hover:border-accent/50 hover:text-primary disabled:opacity-50';

export function LearningReview({ id, canConfirm = true }: { id: string; canConfirm?: boolean }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const run = (feedback: 'useful' | 'not_useful' | 'confirm' | 'dismiss') => startTransition(async () => {
    await reviewLearningItem(id, feedback);
    router.refresh();
  });
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <button className={buttonClass} disabled={pending} onClick={() => run('useful')}>Useful</button>
      <button className={buttonClass} disabled={pending} onClick={() => run('not_useful')}>Not useful</button>
      {canConfirm ? <button className={buttonClass} disabled={pending} onClick={() => run('confirm')}>Confirm</button> : null}
      <button className={buttonClass} disabled={pending} onClick={() => run('dismiss')}>Forget</button>
    </div>
  );
}

export function AdaptationRevert({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return <button className={buttonClass} disabled={pending} onClick={() => startTransition(async () => { await revertAdaptation(id); router.refresh(); })}>{pending ? 'Reverting…' : 'Revert'}</button>;
}

export function CopyProposal({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return <button className={buttonClass} onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1600); }}>{copied ? 'Copied' : 'Copy proposal'}</button>;
}

export function ResetLearning() {
  const [armed, setArmed] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <button
      className="rounded-lg border border-critical/40 px-3 py-2 text-xs text-critical disabled:opacity-50"
      disabled={pending}
      onClick={() => {
        if (!armed) { setArmed(true); return; }
        startTransition(async () => { await resetInferredLearning(); setArmed(false); router.refresh(); });
      }}
    >
      {pending ? 'Resetting…' : armed ? 'Click again to confirm reset' : 'Reset inferred learning'}
    </button>
  );
}
