'use client';

import { motion } from 'motion/react';
import { LockKeyhole, Mic, MicOff, Square } from 'lucide-react';

import { AtlasCore } from '@/features/voice/AtlasCore';
import { OrbitField, type OrbitNode } from '@/features/voice/OrbitField';
import { VOICE_STATE_LABEL } from '@/features/voice/types';
import { useVoiceSession } from '@/features/voice/useVoiceSession';
import { cn } from '@/lib/cn';

/**
 * The Talk surface.
 *
 * The core is the subject; controls sit underneath and stay quiet. The state
 * line is deliberately literal — "Your microphone is off. Atlas is not
 * listening." — because a voice interface that is ambiguous about whether it
 * is recording is a privacy problem wearing a nice animation.
 */
export function VoicePanel({ nodes = [] }: { nodes?: OrbitNode[] }) {
  const { state, error, stream, transcript, start, stop } = useVoiceSession();

  const live = state === 'listening';
  const active = state !== 'idle' && state !== 'error';

  return (
    <div className="flex min-h-[calc(100dvh-12rem)] flex-col items-center justify-center">
      <div className="mb-1 flex min-h-8 items-center gap-2 rounded-full border border-line-subtle bg-surface-inset/60 px-3 text-[0.68rem] tracking-wide text-secondary">
        <LockKeyhole aria-hidden className="size-3 text-positive" />
        Private session
      </div>

      <OrbitField nodes={nodes}>
        <AtlasCore state={state} stream={stream} />
      </OrbitField>

      {/* Status. aria-live so a screen reader hears the state change too. */}
      <motion.div
        className="-mt-6 flex flex-col items-center gap-1.5 sm:-mt-3"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 24 }}
      >
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className={cn(
              'size-1.5 rounded-full',
              live ? 'animate-pulse-soft bg-positive' : active ? 'bg-caution' : 'bg-line-strong',
            )}
          />
          <p
            className="text-2xs font-medium tracking-[0.14em] text-secondary uppercase"
            aria-live="polite"
          >
            {VOICE_STATE_LABEL[state]}
          </p>
        </div>

        <p className="max-w-md text-center text-sm text-tertiary">
          {live ? 'Your microphone is on. Speak naturally.' : 'Your microphone is off. Atlas is not listening.'}
        </p>
      </motion.div>

      <div className="mt-7 flex flex-wrap justify-center gap-2">
        {active ? (
          <motion.button
            type="button"
            onClick={stop}
            whileTap={{ scale: 0.97 }}
            className="flex min-h-14 items-center gap-2 rounded-full border border-line bg-surface-raised px-7 text-sm font-medium text-secondary shadow-[var(--shadow-card)] transition-colors hover:border-line-strong hover:text-primary"
          >
            <Square aria-hidden className="size-4" />
            End session
          </motion.button>
        ) : (
          <motion.button
            type="button"
            onClick={() => void start()}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            className="flex min-h-14 items-center gap-2 rounded-full border border-accent/35 bg-surface-accent px-7 text-sm font-medium text-accent-text shadow-[0_0_34px_-14px_rgb(217_182_74/0.85)] transition-colors hover:bg-forest-700"
          >
            <Mic aria-hidden className="size-4" />
            Start voice session
          </motion.button>
        )}
      </div>

      {error ? (
        <motion.p
          role="alert"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-5 flex max-w-sm items-start gap-2 text-center text-sm text-critical"
        >
          <MicOff aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error}
        </motion.p>
      ) : null}

      {transcript.length > 0 ? (
        <div className="atlas-panel mt-8 w-full max-w-2xl rounded-2xl p-5" aria-label="Session transcript">
          {transcript.slice(-3).map((entry) => (
            <p key={entry.id} className="mb-3 last:mb-0 text-sm leading-relaxed text-secondary">
              <span className="mr-2 text-xs font-semibold tracking-wide text-accent-text uppercase">
                {entry.speaker === 'you' ? 'You' : 'Atlas'}
              </span>
              {entry.text}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
