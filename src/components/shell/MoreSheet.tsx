'use client';

import { MoreHorizontal, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { SECONDARY_NAV_ITEMS } from '@/components/shell/nav';
import { cn } from '@/lib/cn';

/**
 * Mobile access to the screens that do not fit the bottom bar.
 *
 * Without this, six of the eleven routes — including Settings, where Google is
 * connected — were unreachable on a phone entirely. A five-slot bar is a
 * layout constraint, not a reason to make features inaccessible.
 */
export function MoreSheet() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Escape closes it, and the background must not scroll underneath.
  useEffect(() => {
    if (!open) return;

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  const isActive = SECONDARY_NAV_ITEMS.some(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cn(
          'flex min-h-14 w-full flex-col items-center justify-center gap-1 px-1 py-2 transition-colors',
          isActive ? 'text-accent-text' : 'text-tertiary hover:text-secondary',
        )}
      >
        <MoreHorizontal aria-hidden className="size-5" />
        <span className="text-2xs font-medium">More</span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="More screens"
          className="fixed inset-0 z-50 lg:hidden"
        >
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-charcoal-950/70 backdrop-blur-sm"
          />

          <div
            className="animate-rise absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-white/10 bg-surface-raised p-5 shadow-[var(--shadow-raised)]"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.25rem)' }}
          >
            <div className="mb-4 flex items-center justify-between">
              <p className="text-2xs font-semibold tracking-[0.12em] text-tertiary uppercase">
                More
              </p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="grid size-9 place-items-center rounded-full text-tertiary hover:text-primary"
              >
                <X aria-hidden className="size-4" />
              </button>
            </div>

            <ul className="grid grid-cols-2 gap-2">
              {SECONDARY_NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      // Closed here rather than in an effect on pathname:
                      // dismissing is a response to the tap, not state being
                      // synchronised after the fact.
                      onClick={() => setOpen(false)}
                      className={cn(
                        'flex min-h-16 flex-col justify-center gap-1 rounded-lg border border-line-subtle px-4 py-3 transition-colors',
                        active
                          ? 'bg-accent-muted text-primary'
                          : 'text-secondary hover:bg-surface-overlay hover:text-primary',
                      )}
                    >
                      <span className="flex items-center gap-2 text-sm font-medium">
                        <Icon
                          aria-hidden
                          className={cn('size-4', active ? 'text-accent-text' : 'text-tertiary')}
                        />
                        {item.label}
                      </span>
                      <span className="text-2xs text-tertiary">{item.description}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}
