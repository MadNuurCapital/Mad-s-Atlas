'use client';

import { Lightbulb, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';

import { captureIdeaAction } from '@/features/ideas/actions';

export function IdeaCaptureForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await captureIdeaAction(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      formRef.current?.reset();
      setExpanded(false);
      if (result.ideaId) router.push(`/ideas/${result.ideaId}`);
      router.refresh();
    });
  }

  return (
    <form ref={formRef} action={submit} className="atlas-panel atlas-corners mb-8 rounded-2xl p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-muted text-accent-text">
          <Lightbulb aria-hidden className="size-4" />
        </span>
        <input
          name="title"
          required
          maxLength={200}
          placeholder="Give your idea a short title"
          onFocus={() => setExpanded(true)}
          className="min-h-11 min-w-0 flex-1 bg-transparent text-sm text-primary outline-none placeholder:text-tertiary"
        />
        <button
          type="submit"
          disabled={pending}
          className="flex min-h-11 shrink-0 items-center gap-2 rounded-full bg-surface-accent px-4 text-sm font-medium text-accent-text disabled:opacity-60"
        >
          <Sparkles aria-hidden className="size-4" />
          {pending ? 'Capturing…' : 'Capture'}
        </button>
      </div>
      {expanded ? (
        <textarea
          name="originalCapture"
          required
          maxLength={8000}
          rows={4}
          placeholder="Describe it naturally. Atlas preserves these exact words."
          className="mt-3 w-full resize-y rounded-xl border border-line bg-surface-inset px-4 py-3 text-sm leading-relaxed text-primary outline-none placeholder:text-tertiary focus:border-accent"
        />
      ) : null}
      {error ? <p role="alert" className="mt-3 text-sm text-critical">{error}</p> : null}
    </form>
  );
}
