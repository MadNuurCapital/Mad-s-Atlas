import Image from 'next/image';

import { cn } from '@/lib/cn';

/** Canonical Atlas emblem, adapted directly from the supplied brand artwork. */
export function AtlasMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn('flex items-center', compact ? 'gap-2.5' : 'gap-3.5')}>
      <Image
        src="/icons/atlas-192.png"
        alt=""
        aria-hidden
        width={compact ? 36 : 48}
        height={compact ? 36 : 48}
        priority
        className={cn(
          'shrink-0 rounded-[26%] border border-accent/25 shadow-[0_0_22px_-9px_rgb(217_182_74/0.7)]',
          compact ? 'size-9' : 'size-12',
        )}
      />

      <span className="min-w-0 leading-tight">
        <span className={cn('font-display block text-primary', compact ? 'text-lg' : 'text-xl')}>
          Mad&rsquo;s Atlas
        </span>
        <span className="mt-0.5 block text-[0.67rem] tracking-[0.14em] text-tertiary uppercase">
          Personal AI OS
        </span>
      </span>
    </div>
  );
}
