import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * Standard page frame. Every route uses this so spacing, heading hierarchy and
 * max-width stay consistent without each screen reinventing them.
 */
export function Page({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 lg:py-12">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
          {description ? (
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-secondary">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      {children}
    </div>
  );
}

export function Section({
  title,
  description,
  children,
  className,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('mb-8', className)}>
      {title ? (
        <div className="mb-3 flex items-center gap-3">
          <h2 className="text-2xs font-semibold tracking-[0.12em] text-tertiary uppercase">
            {title}
          </h2>
          <span aria-hidden className="h-px flex-1 bg-line-subtle" />
        </div>
      ) : null}
      {description ? <p className="mb-3 text-sm text-tertiary">{description}</p> : null}
      {children}
    </section>
  );
}

export function Card({
  children,
  className,
  as: Component = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'article' | 'li';
}) {
  return (
    <Component
      className={cn(
        'rounded-lg border border-line-subtle bg-surface-raised p-5 shadow-[var(--shadow-card)]',
        className,
      )}
    >
      {children}
    </Component>
  );
}
