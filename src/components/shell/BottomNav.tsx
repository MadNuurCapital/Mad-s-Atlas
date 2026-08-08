'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { MoreSheet } from '@/components/shell/MoreSheet';
import { MOBILE_NAV_ITEMS } from '@/components/shell/nav';
import { cn } from '@/lib/cn';

/**
 * Mobile navigation.
 *
 * Five destinations, 56px minimum touch targets, and padding for the iOS home
 * indicator so the last row is never covered.
 */
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line-subtle bg-surface-inset/92 shadow-[0_-20px_50px_-30px_rgb(0_0_0/0.9)] backdrop-blur-xl lg:hidden"
      style={{
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      <ul className="grid grid-cols-5">
        {MOBILE_NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          const isTalk = item.href === '/talk';

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'relative flex min-h-16 flex-col items-center justify-center gap-1 px-1 py-2 transition-colors',
                  isTalk && '-mt-4',
                  isActive ? 'text-accent-text' : 'text-tertiary hover:text-secondary',
                )}
              >
                <span
                  className={cn(
                    'grid place-items-center',
                    isTalk &&
                      'size-12 rounded-full border border-accent/40 bg-surface-accent text-accent-text shadow-[0_0_28px_-9px_rgb(217_182_74/0.75)]',
                  )}
                >
                  <Icon aria-hidden className={cn('size-5', isTalk && 'size-[1.15rem]')} />
                </span>
                <span className="text-2xs font-medium">{item.label}</span>
              </Link>
            </li>
          );
        })}

        {/* Fifth slot: everything that does not fit above. */}
        <li>
          <MoreSheet />
        </li>
      </ul>
    </nav>
  );
}
