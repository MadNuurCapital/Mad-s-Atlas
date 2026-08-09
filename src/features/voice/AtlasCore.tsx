'use client';

import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react';
import Image from 'next/image';
import { useEffect, useRef } from 'react';

import type { VoiceState } from '@/features/voice/types';
import { cn } from '@/lib/cn';

/**
 * The Atlas core — the thing you actually look at while talking.
 *
 * It reacts to REAL audio, not a timer. When Atlas is listening the ring
 * responds to your microphone; when Atlas is speaking it responds to its own
 * output. That distinction is the point: a core that pulses on a fixed loop
 * looks alive but tells you nothing, and would happily "listen" with the
 * microphone off. This one cannot fake it — no signal, no movement.
 */

type Props = {
  state: VoiceState;
  /** Live media stream while listening. Null when the microphone is off. */
  stream: MediaStream | null;
  /** RMS of Atlas's real PCM response audio, normalised to 0..1. */
  outputLevel: number;
  /** Speaking-only action: stop Atlas output and return to listening. */
  onInterrupt?: () => void;
};

/** Colour per state. Gold is the brand accent; it earns its place by meaning something. */
const STATE_TINT: Record<VoiceState, string> = {
  idle: 'var(--border-strong)',
  requesting_permission: 'var(--color-caution)',
  connecting: 'var(--color-caution)',
  listening: 'var(--color-gold-400)',
  understanding: 'var(--color-forest-300)',
  using_tool: 'var(--color-forest-300)',
  speaking: 'var(--color-gold-300)',
  reconnecting: 'var(--color-caution)',
  error: 'var(--color-critical)',
};

export function AtlasCore({ state, stream, outputLevel, onInterrupt }: Props) {
  const reduceMotion = useReducedMotion();

  /**
   * Loudness, 0..1, as a motion value rather than React state.
   *
   * This runs at 60fps. Held in state it would re-render the component on
   * every frame; a motion value writes straight to the DOM and React never
   * sees it. The spring then gives the movement mass, so the core settles
   * instead of twitching on every sample.
   */
  const level = useMotionValue(0);
  const smooth = useSpring(level, { stiffness: 220, damping: 22, mass: 0.5 });

  const frameRef = useRef<number | null>(null);

  /**
   * Drive `level` from the live stream.
   *
   * Teardown closes the AudioContext: browsers cap how many can exist, and a
   * leaked one per session eventually refuses to open a new one — the voice
   * UI would then silently stop reacting.
   */
  useEffect(() => {
    // While Atlas speaks, the core follows the actual decoded PCM response.
    // Do not leave the microphone analyser competing for the same motion value.
    if (state === 'speaking') {
      level.set(outputLevel);
      return;
    }

    // No stream means the microphone is off. Falling to zero is not
    // decoration — a still ring is how the interface tells the truth about
    // not capturing.
    if (!stream) {
      level.set(0);
      return;
    }

    let cancelled = false;
    const context = new AudioContext();

    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    // Smoothing here rather than in React: a jittery number would cause a
    // render per frame and still look twitchy.
    analyser.smoothingTimeConstant = 0.8;

    context.createMediaStreamSource(stream).connect(analyser);
    const bins = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      if (cancelled) return;
      analyser.getByteFrequencyData(bins);

      let sum = 0;
      for (const value of bins) sum += value;
      const average = sum / bins.length / 255;

      // Slight curve: quiet speech should still register visibly.
      level.set(Math.min(1, average * 2.2));
      frameRef.current = requestAnimationFrame(tick);
    };

    tick();

    return () => {
      cancelled = true;
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      void context.close();
    };
  }, [stream, state, outputLevel, level]);

  const tint = STATE_TINT[state];
  const active = state === 'listening' || state === 'speaking';

  // Reduced motion still gets a state colour and a static ring — the
  // information survives; only the movement goes.
  const ringScale = useTransform(smooth, (v) => (reduceMotion ? 1 : 1 + v * 0.14));
  const coreScale = useTransform(smooth, (v) => (reduceMotion ? 1 : 1 + v * 0.08));
  const fieldScale = useTransform(smooth, (v) => (reduceMotion ? 1 : 0.85 + v * 0.3));
  const fieldOpacity = useTransform(smooth, (v) =>
    active ? (reduceMotion ? 0.25 : 0.12 + v * 0.4) : 0.12,
  );
  const ringGlow = useTransform(smooth, (v) => `0 0 ${20 + v * 50}px -8px ${tint}`);

  return (
    <button
      type="button"
      onClick={state === 'speaking' ? onInterrupt : undefined}
      disabled={state !== 'speaking'}
      aria-label={state === 'speaking' ? 'Interrupt Atlas' : 'Atlas voice status'}
      className={cn(
        'relative grid aspect-square w-full max-w-[19rem] place-items-center rounded-full sm:max-w-[23rem]',
        state === 'speaking' && 'cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent',
      )}
    >
      {/* Outer field — widens with volume, so loudness reads as presence. */}
      <motion.div
        aria-hidden
        className="absolute inset-0 rounded-full"
        style={{
          opacity: fieldOpacity,
          scale: fieldScale,
          background: `radial-gradient(circle, ${tint} 0%, transparent 62%)`,
          filter: 'blur(28px)',
        }}
      />

      {/* Ring */}
      <motion.div
        aria-hidden
        className="absolute size-52 rounded-full border sm:size-64"
        animate={{ borderColor: tint, opacity: active ? 0.9 : 0.4 }}
        transition={{ duration: 0.4 }}
        style={{ scale: ringScale, boxShadow: ringGlow }}
      />

      {/* Core */}
      <motion.div
        className={cn(
          'relative grid size-28 place-items-center overflow-hidden rounded-full sm:size-36',
          'border border-accent/20 bg-surface-raised/85 backdrop-blur-xl',
        )}
        style={{
          scale: coreScale,
          boxShadow: `inset 0 0 30px -10px ${tint}, 0 8px 40px -12px rgb(0 0 0 / 0.6)`,
        }}
      >
        <Image
          src="/icons/atlas-192.png"
          alt="Atlas core"
          width={144}
          height={144}
          priority
          className="size-full object-cover"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-inset ring-accent/25"
        />
      </motion.div>
    </button>
  );
}
