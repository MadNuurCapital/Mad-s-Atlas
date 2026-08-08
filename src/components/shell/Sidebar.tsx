'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { AtlasMark } from '@/components/shell/AtlasMark';
import { PRIMARY_NAV_ITEMS, SECONDARY_NAV_ITEMS } from '@/components/shell/nav';
import { ThemeToggle } from '@/components/shell/ThemeToggle';
import { cn } from '@/lib/cn';

/** Desktop navigation. Hidden below `lg`, where the bottom bar takes over. */
export function Sidebar({ profile }: { profile: ReactNode }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="relative hidden lg:flex lg:w-[17rem] lg:shrink-0 lg:flex-col lg:border-r lg:border-line-subtle lg:bg-surface-inset/55"
    >
      <div aria-hidden className="atlas-grid pointer-events-none absolute inset-0 opacity-50" />
      <div className="relative px-7 pt-7 pb-8">
        <AtlasMark />
      </div>

      <NavGroup label="Workspace" items={PRIMARY_NAV_ITEMS} pathname={pathname} />
      <NavGroup label="Atlas" items={SECONDARY_NAV_ITEMS} pathname={pathname} secondary />

      <div className="relative mt-auto border-t border-line-subtle px-4 pt-4 pb-5">
        {profile}
        <div className="mt-2">
          <ThemeToggle />
        </div>
      </div>
    </nav>
  );
}

function NavGroup({
  label,
  items,
  pathname,
  secondary = false,
}: {
  label: string;
  items: typeof PRIMARY_NAV_ITEMS | typeof SECONDARY_NAV_ITEMS;
  pathname: string;
  secondary?: boolean;
}) {
  return (
    <div className="relative px-4 pb-5">
      <p className="mb-2 px-3 text-[0.64rem] font-semibold tracking-[0.16em] text-tertiary/80 uppercase">
        {label}
      </p>
      <ul className="space-y-1">
        {items.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'group relative flex min-h-11 items-center gap-3 rounded-xl py-2 pr-3 pl-3.5 text-sm transition-all',
                  isActive
                    ? 'bg-accent-muted font-medium text-accent-text shadow-[inset_0_0_0_1px_rgb(217_182_74/0.08)]'
                    : secondary
                      ? 'text-tertiary hover:bg-surface-overlay hover:text-primary'
                      : 'text-secondary hover:bg-surface-overlay hover:text-primary',
                )}
              >
                {/* Gold rail marks the active section — the one place the
                    brand accent carries meaning rather than decoration. */}
                <span
                  aria-hidden
                  className={cn(
                    'absolute top-2.5 bottom-2.5 left-0 w-0.5 rounded-full transition-colors',
                    isActive ? 'bg-accent shadow-[0_0_12px_rgb(217_182_74/0.45)]' : 'bg-transparent',
                  )}
                />
                <Icon
                  aria-hidden
                  className={cn(
                    'size-[1.05rem] shrink-0 transition-colors',
                    isActive ? 'text-accent-text' : 'text-tertiary group-hover:text-secondary',
                  )}
                />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
