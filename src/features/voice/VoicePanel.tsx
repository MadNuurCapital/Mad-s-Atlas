'use client';

import { motion } from 'motion/react';
import { Mic, MicOff, Square } from 'lucide-react';

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
  const { state, error, stream, start, stop } = useVoiceSession();

  const live = state === 'listening';
  const active = state !== 'idle' && state !== 'error';

  return (
    <div className="flex flex-col items-center">
      <OrbitField nodes={nodes}>
        <AtlasCore state={state} stream={stream} />
      </OrbitField>

      {/* Status. aria-live so a screen reader hears the state change too. */}
      <motion.div
        className="mt-2 flex flex-col items-center gap-1.5"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 24 }}
      >
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className={cn(
              'size-1.5 rounded-full',
              live ? 'animate-pulse-soft bg-critical' : active ? 'bg-caution' : 'bg-line-strong',
            )}
          />
          <p
            className="text-2xs font-medium tracking-[0.14em] text-secondary uppercase"
            aria-live="polite"
          >
            {VOICE_STATE_LABEL[state]}
          </p>
        </div>

        <p className="text-sm text-tertiary">
          {live ? 'Your microphone is on.' : 'Your microphone is off. Atlas is not listening.'}
        </p>
      </motion.div>

      <div className="mt-7 flex flex-wrap justify-center gap-2">
        {active ? (
          <motion.button
            type="button"
            onClick={stop}
            whileTap={{ scale: 0.97 }}
            className="flex min-h-12 items-center gap-2 rounded-full border border-line px-6 text-sm font-medium text-secondary transition-colors hover:text-primary"
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
            className="flex min-h-12 items-center gap-2 rounded-full bg-surface-accent px-6 text-sm font-medium text-accent-text ring-1 ring-gold-500/25 transition-colors hover:bg-forest-700"
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

      <p className="mt-8 max-w-sm text-center text-2xs leading-relaxed text-tertiary">
        The ring responds to real audio, not a timer — if it is still, nothing is being captured.
        Raw audio is never stored.
      </p>
    </div>
  );
}
