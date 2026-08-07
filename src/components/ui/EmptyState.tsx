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
    <div className="atlas-panel rounded-2xl border-dashed px-6 py-12 text-center">
      <span className="mx-auto grid size-10 place-items-center rounded-full bg-accent-muted">
        <Icon aria-hidden className="size-[1.1rem] text-accent-text" />
      </span>
      <p className="mt-4 text-base font-medium text-primary">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-tertiary">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
