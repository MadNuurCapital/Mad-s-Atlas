'use client';

import { Mic, MicOff, Square } from 'lucide-react';

import { VOICE_STATE_LABEL } from '@/features/voice/types';
import { useVoiceSession } from '@/features/voice/useVoiceSession';
import { cn } from '@/lib/cn';

/**
 * Voice controls.
 *
 * The state indicator is load-bearing, not decoration: it shows `listening`
 * only when the microphone is genuinely capturing. Push-to-talk is the
 * default, and there is no always-on background microphone in V1.
 */
export function VoicePanel() {
  const { state, error, start, stop } = useVoiceSession();

  const live = state === 'listening';
  const active = state !== 'idle' && state !== 'error';

  return (
    <div className="rounded-lg border border-line-subtle bg-surface-raised p-6">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className={cn(
            'size-2 rounded-full',
            live ? 'animate-pulse-soft bg-critical' : active ? 'bg-caution' : 'bg-line-strong',
          )}
        />
        <p className="text-sm font-medium text-primary" aria-live="polite">
          {VOICE_STATE_LABEL[state]}
        </p>
      </div>

      <p className="mt-2 text-sm leading-relaxed text-tertiary">
        {live
          ? 'Your microphone is on. Atlas is listening.'
          : 'Your microphone is off. Atlas is not listening.'}
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        {active ? (
          <button
            type="button"
            onClick={stop}
            className="flex min-h-12 items-center gap-2 rounded-md border border-line px-5 text-sm font-medium text-secondary transition-colors hover:text-primary"
          >
            <Square aria-hidden className="size-4" />
            End session
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void start()}
            className="flex min-h-12 items-center gap-2 rounded-md bg-surface-accent px-5 text-sm font-medium text-accent-text transition-colors hover:bg-forest-700"
          >
            <Mic aria-hidden className="size-4" />
            Start voice session
          </button>
        )}
      </div>

      {error ? (
        <p role="alert" className="mt-4 flex items-start gap-2 text-sm text-critical">
          <MicOff aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}

      <p className="mt-5 border-t border-line-subtle pt-4 text-2xs leading-relaxed text-tertiary">
        Raw audio is never stored — not on our servers, not on disk. Transcripts
        stay in this session unless you save them.
      </p>
    </div>
  );
}
