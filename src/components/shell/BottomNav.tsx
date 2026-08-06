'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { MoreSheet } from '@/components/shell/MoreSheet';
import { PRIMARY_NAV_ITEMS } from '@/components/shell/nav';
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
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line-subtle bg-surface-raised/95 backdrop-blur-sm lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="grid grid-cols-5">
        {PRIMARY_NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex min-h-14 flex-col items-center justify-center gap-1 px-1 py-2 transition-colors',
                  isActive ? 'text-accent-text' : 'text-tertiary hover:text-secondary',
                )}
              >
                <Icon aria-hidden className="size-5" />
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
