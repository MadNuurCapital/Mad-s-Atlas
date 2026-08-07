import { cn } from '@/lib/cn';

/** A restrained typographic monogram; intentionally not an app-icon square. */
export function AtlasMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn('flex items-center', compact ? 'gap-2.5' : 'gap-3.5')}>
      <span
        aria-hidden
        className={cn(
          'relative grid place-items-center text-accent-text',
          compact ? 'size-9' : 'size-12',
        )}
      >
        <span className={cn('font-display leading-none', compact ? 'text-3xl' : 'text-[2.65rem]')}>
          A
        </span>
        <span className="absolute top-0 right-0 text-[0.55rem] text-accent">✦</span>
        <span className="absolute right-1 bottom-0 left-1 h-px bg-gradient-to-r from-transparent via-accent/70 to-transparent" />
      </span>

      <span className="min-w-0 leading-tight">
        <span className={cn('font-display block text-primary', compact ? 'text-lg' : 'text-xl')}>
          Mad&rsquo;s Atlas
        </span>
        <span className="mt-0.5 block text-[0.67rem] tracking-[0.14em] text-tertiary uppercase">
          Personal AI
        </span>
      </span>
    </div>
  );
}
