'use client';

import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react';
import { useEffect, useRef, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * The orbit system around the core.
 *
 * Nodes are what Atlas is holding for you right now — the next reminder, an
 * email needing a reply, a pending approval. They orbit because that reads as
 * "in attendance, not demanding", which is the right posture for an assistant.
 *
 * Everything here degrades to a static, readable ring under
 * `prefers-reduced-motion`. Motion is the decoration; the arrangement carries
 * the meaning.
 */

export type OrbitNode = {
  id: string;
  label: string;
  /** Which ring. 0 is closest to the core — the most urgent. */
  ring: 0 | 1;
  /** Pulls focus without shouting. */
  urgent?: boolean;
  onSelect?: () => void;
};

const RING_RADIUS = [128, 196] as const;
const RING_DURATION = [38, 62] as const;

export function OrbitField({
  nodes,
  children,
  dimmed = false,
}: {
  nodes: OrbitNode[];
  /** The core sits at the centre. */
  children: ReactNode;
  /** True while a card is open — the field recedes so text can be read. */
  dimmed?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);

  // Pointer-driven tilt. Springs give it mass so it settles rather than
  // snapping, which is the difference between "physical" and "twitchy".
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const rotateX = useSpring(useTransform(pointerY, [-0.5, 0.5], [8, -8]), {
    stiffness: 90,
    damping: 20,
  });
  const rotateY = useSpring(useTransform(pointerX, [-0.5, 0.5], [-10, 10]), {
    stiffness: 90,
    damping: 20,
  });

  useEffect(() => {
    if (reduceMotion || nodes.length === 0) return;
    const element = containerRef.current;
    if (!element) return;

    function handle(event: PointerEvent) {
      const bounds = element?.getBoundingClientRect();
      if (!bounds) return;
      pointerX.set((event.clientX - bounds.left) / bounds.width - 0.5);
      pointerY.set((event.clientY - bounds.top) / bounds.height - 0.5);
    }

    function reset() {
      pointerX.set(0);
      pointerY.set(0);
    }

    // Pointer events only — no device orientation. iOS requires a permission
    // prompt for gyroscope, and spending one of those on a decorative tilt
    // would be a poor trade against the microphone prompt that actually matters.
    window.addEventListener('pointermove', handle);
    window.addEventListener('pointerleave', reset);
    return () => {
      window.removeEventListener('pointermove', handle);
      window.removeEventListener('pointerleave', reset);
    };
  }, [nodes.length, pointerX, pointerY, reduceMotion]);

  return (
    <div
      ref={containerRef}
      className="relative grid min-h-[23rem] w-full place-items-center py-4 sm:min-h-[28rem]"
      style={{ perspective: '1200px' }}
    >
      <motion.div
        className="relative grid place-items-center"
        style={reduceMotion ? undefined : { rotateX, rotateY, transformStyle: 'preserve-3d' }}
        animate={{
          opacity: dimmed ? 0.25 : 1,
          filter: dimmed ? 'blur(3px)' : 'blur(0px)',
        }}
        transition={{ duration: 0.35 }}
      >
        {/* Orbit paths — faint, so they suggest structure without competing. */}
        {nodes.length > 0 ? RING_RADIUS.map((radius, index) => (
          <div
            key={radius}
            aria-hidden
            className="absolute rounded-full border border-line-subtle/60"
            style={{ width: radius * 2, height: radius * 2 }}
            data-ring={index}
          />
        )) : null}

        {nodes.map((node) => {
          const ringNodes = nodes.filter((n) => n.ring === node.ring);
          const position = ringNodes.indexOf(node);
          const offset = (360 / Math.max(ringNodes.length, 1)) * position;
          const radius = RING_RADIUS[node.ring];
          const duration = RING_DURATION[node.ring];

          return (
            <motion.div
              key={node.id}
              className="absolute"
              animate={reduceMotion ? { rotate: offset } : { rotate: [offset, offset + 360] }}
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : { duration, repeat: Infinity, ease: 'linear' }
              }
              style={{ width: radius * 2, height: radius * 2 }}
            >
              <OrbitChip
                node={node}
                offset={offset}
                reduceMotion={Boolean(reduceMotion)}
              />
            </motion.div>
          );
        })}

        {children}
      </motion.div>
    </div>
  );
}

function OrbitChip({
  node,
  offset,
  reduceMotion,
}: {
  node: OrbitNode;
  /** The parent ring's starting angle, which this must cancel. */
  offset: number;
  reduceMotion: boolean;
}) {
  return (
    <motion.button
      type="button"
      onClick={node.onSelect}
      // Counter-rotates so the label stays upright while the ring turns.
      //
      // It must start at -offset, not 0: the parent begins its sweep already
      // rotated to `offset`, and a child starting at 0 inherits that as a
      // permanent tilt. Every chip except the one at offset 0 sat at an angle
      // and was unreadable — which defeats the point of putting information
      // out here at all.
      animate={reduceMotion ? { rotate: -offset } : { rotate: [-offset, -offset - 360] }}
      transition={
        reduceMotion
          ? undefined
          : {
              duration: RING_DURATION[node.ring],
              repeat: Infinity,
              ease: 'linear',
            }
      }
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.96 }}
      className={cn(
        'absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2',
        'flex max-w-[9rem] items-center gap-1.5 rounded-full px-3 py-1.5',
        'border border-white/10 bg-surface-overlay/70 backdrop-blur-md',
        'text-2xs font-medium whitespace-nowrap text-secondary',
        'shadow-[0_4px_20px_-8px_rgb(0_0_0/0.7)] transition-colors',
        'hover:text-primary focus-visible:text-primary',
        node.urgent && 'border-gold-500/40 text-accent-text',
      )}
    >
      {node.urgent ? (
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-accent" />
      ) : null}
      <span className="truncate">{node.label}</span>
    </motion.button>
  );
}
