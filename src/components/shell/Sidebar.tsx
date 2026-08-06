'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { NAV_ITEMS } from '@/components/shell/nav';
import { ThemeToggle } from '@/components/shell/ThemeToggle';
import { cn } from '@/lib/cn';

/** Desktop navigation. Hidden below `lg`, where the bottom bar takes over. */
export function Sidebar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="hidden lg:flex lg:w-64 lg:shrink-0 lg:flex-col lg:border-r lg:border-line-subtle lg:bg-surface-raised"
    >
      <div className="flex h-16 items-center gap-3 border-b border-line-subtle px-5">
        <span
          aria-hidden
          className="grid size-8 place-items-center rounded-md bg-surface-accent text-sm font-semibold text-accent-text ring-1 ring-gold-500/25"
        >
          A
        </span>
        <div className="leading-tight">
          <p className="text-sm font-semibold tracking-tight">Mad&rsquo;s Atlas</p>
          <p className="text-2xs text-tertiary">Personal operating system</p>
        </div>
      </div>

      <ul className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'group relative flex items-center gap-3 rounded-md py-2 pr-3 pl-4 text-sm transition-colors',
                  isActive
                    ? 'bg-accent-muted font-medium text-primary'
                    : 'text-secondary hover:bg-surface-overlay hover:text-primary',
                )}
              >
                {/* Gold rail marks the active section — the one place the
                    brand accent carries meaning rather than decoration. */}
                <span
                  aria-hidden
                  className={cn(
                    'absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full transition-colors',
                    isActive ? 'bg-accent' : 'bg-transparent',
                  )}
                />
                <Icon
                  aria-hidden
                  className={cn(
                    'size-4 shrink-0 transition-colors',
                    isActive ? 'text-accent-text' : 'text-tertiary group-hover:text-secondary',
                  )}
                />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="border-t border-line-subtle p-3">
        <ThemeToggle />
      </div>
    </nav>
  );
}
