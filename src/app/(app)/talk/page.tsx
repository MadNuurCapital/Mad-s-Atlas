import { ChevronDown } from 'lucide-react';
import type { Metadata } from 'next';

import { VoicePanel } from '@/features/voice/VoicePanel';

export const metadata: Metadata = { title: 'Talk' };

const SUGGESTIONS = [
  'What tasks are due today?',
  'Remind me tomorrow at 9 AM',
  'What is on my calendar today?',
  'Research today’s most important market signal',
] as const;

export default function TalkPage() {
  return (
    <div className="atlas-safe-top relative min-h-[calc(100dvh-6rem)] overflow-hidden px-4 py-6 sm:px-8 lg:min-h-dvh lg:px-10 lg:py-8">
      <div aria-hidden className="atlas-grid pointer-events-none absolute inset-0 opacity-35" />
      <div aria-hidden className="pointer-events-none absolute top-[12%] left-1/2 size-[30rem] max-w-[95vw] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgb(39_107_78/0.18),transparent_66%)] blur-2xl" />

      <header className="relative z-10 mx-auto flex max-w-6xl items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-accent-text uppercase">Voice</p>
          <h1 className="font-display mt-1 text-3xl text-primary sm:text-4xl">Atlas</h1>
        </div>
        <details className="group relative text-right">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-full border border-line-subtle bg-surface-raised/70 px-4 text-xs text-secondary transition-colors hover:text-primary">
            Session privacy
            <ChevronDown aria-hidden className="size-3.5 transition-transform group-open:rotate-180" />
          </summary>
          <div className="atlas-panel absolute top-13 right-0 z-30 w-[min(22rem,calc(100vw-2rem))] rounded-2xl p-5 text-left shadow-[var(--shadow-raised)]">
            <p className="text-sm font-medium text-primary">Private by design</p>
            <ul className="mt-3 space-y-2 text-xs leading-relaxed text-tertiary">
              <li>Audio goes directly to Gemini and is never stored.</li>
              <li>Each session uses a short-lived, single-use token.</li>
            <li>Calendar events can be created directly; protected actions still require approval.</li>
            </ul>
          </div>
        </details>
      </header>

      <main className="relative z-0 mx-auto max-w-6xl">
        <VoicePanel />

        <div className="-mt-6 pb-6 text-center sm:-mt-2">
          <p className="text-xs font-semibold tracking-[0.13em] text-tertiary uppercase">
            Try saying
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {SUGGESTIONS.map((suggestion) => (
              <span
                key={suggestion}
                className="rounded-full border border-line-subtle bg-surface-raised/50 px-4 py-2 text-xs text-secondary"
              >
                {suggestion}
              </span>
            ))}
          </div>
          <p className="mx-auto mt-5 max-w-lg text-xs leading-relaxed text-tertiary">
            The core responds only to real microphone input. When it is still, nothing is being captured.
          </p>
        </div>
      </main>
    </div>
  );
}
