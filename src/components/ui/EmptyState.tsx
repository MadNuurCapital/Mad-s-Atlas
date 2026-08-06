import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Honest empty state.
 *
 * Used everywhere a screen has no data yet. It says what will appear here and
 * why it is empty — it never renders sample data dressed up as real content.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-surface-raised/40 px-6 py-14 text-center">
      <Icon aria-hidden className="mx-auto size-6 text-tertiary" />
      <p className="mt-4 text-sm font-medium text-primary">{title}</p>
      <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-tertiary">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
