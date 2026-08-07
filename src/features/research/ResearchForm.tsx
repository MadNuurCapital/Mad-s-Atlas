'use client';

import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { runResearch } from '@/features/research/actions';

export function ResearchForm() {
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await runResearch(query);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setQuery('');
      router.refresh();
    });
  }

  return (
    <div className="atlas-panel-emphasis rounded-3xl p-5 sm:p-7">
      <label htmlFor="research-query" className="font-display text-2xl text-primary">
        What should Atlas investigate?
      </label>
      <p className="mt-2 text-sm leading-relaxed text-secondary">
        Current information is searched live and saved with its grounded sources.
      </p>
      <textarea
        id="research-query"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        rows={3}
        maxLength={1000}
        placeholder="Research a company, market, technology, regulation or question…"
        className="mt-5 w-full resize-y rounded-xl border border-line bg-surface-inset px-4 py-3 text-sm leading-relaxed text-primary placeholder:text-tertiary focus:border-accent focus:outline-none"
      />
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-2xs text-tertiary">Sources are taken from Google grounding metadata, never invented.</p>
        <button
          type="button"
          disabled={pending || query.trim().length < 3}
          onClick={submit}
          className="flex min-h-11 shrink-0 items-center gap-2 rounded-full bg-surface-accent px-5 text-sm font-medium text-accent-text disabled:opacity-60"
        >
          <Search aria-hidden className="size-4" />
          {pending ? 'Researching…' : 'Research'}
        </button>
      </div>
      {error ? <p role="alert" className="mt-3 text-sm text-critical">{error}</p> : null}
    </div>
  );
}
