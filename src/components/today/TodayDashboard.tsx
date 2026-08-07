import {
  ArrowRight,
  BellRing,
  CalendarDays,
  CheckSquare,
  Clock3,
  Inbox,
  Lightbulb,
  Mic,
  Plus,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';

import { cn } from '@/lib/cn';

export type TodayTimelineItem = {
  id: string;
  time: string;
  title: string;
  detail?: string;
  active?: boolean;
};

export type TodayPriority = {
  eyebrow: string;
  title: string;
  time?: string;
  context?: string;
  href: string;
  action: string;
};

type AttentionItem = {
  label: string;
  value: string;
  detail: string;
  href: string;
  tone?: 'calm' | 'attention';
  icon: typeof ShieldCheck;
};

export function CommandBar() {
  return (
    <Link
      href="/talk"
      aria-label="Ask Atlas anything using voice"
      className="group flex min-h-16 w-full items-center gap-4 rounded-2xl border border-accent/25 bg-surface-raised/80 px-4 shadow-[0_18px_70px_-34px_rgb(217_182_74/0.5)] transition-colors hover:border-accent/40 hover:bg-surface-overlay sm:px-5"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-full border border-accent/20 bg-accent-muted text-accent-text">
        <Sparkles aria-hidden className="size-4" />
      </span>
      <span className="min-w-0 flex-1 text-left text-sm text-secondary sm:text-base">
        Ask Atlas anything&hellip;
      </span>
      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent text-charcoal-950 shadow-[0_0_25px_-7px_rgb(217_182_74/0.8)] transition-transform group-hover:scale-105">
        <Mic aria-hidden className="size-[1.1rem]" />
      </span>
    </Link>
  );
}

export function HeroPriority({ priority }: { priority: TodayPriority | null }) {
  return (
    <article className="atlas-panel-emphasis relative min-h-[18rem] overflow-hidden rounded-3xl p-6 sm:p-7">
      <div aria-hidden className="atlas-grid absolute inset-0 opacity-50" />
      <div aria-hidden className="absolute right-[-8%] bottom-[-45%] size-72 rounded-full border border-accent/15" />
      <div aria-hidden className="absolute right-[4%] bottom-[-34%] size-56 rounded-full border border-accent/10" />

      <div className="relative flex h-full min-h-[14.5rem] flex-col">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold tracking-[0.14em] text-accent-text uppercase">
            {priority?.eyebrow ?? 'Next up'}
          </p>
          <StatusBadge>{priority ? 'Ready' : 'Clear'}</StatusBadge>
        </div>

        {priority ? (
          <>
            <div className="my-auto py-7">
              <h2 className="font-display max-w-xl text-3xl leading-[1.08] text-primary sm:text-4xl">
                {priority.title}
              </h2>
              {priority.time ? (
                <p className="mt-4 flex items-center gap-2 text-sm font-medium text-accent-text">
                  <Clock3 aria-hidden className="size-4" /> {priority.time}
                </p>
              ) : null}
              {priority.context ? (
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-secondary">
                  {priority.context}
                </p>
              ) : null}
            </div>
            <Link
              href={priority.href}
              className="flex min-h-11 w-fit items-center gap-2 rounded-full border border-accent/30 bg-accent-muted px-5 text-sm font-medium text-accent-text transition-colors hover:bg-accent/20"
            >
              {priority.action} <ArrowRight aria-hidden className="size-4" />
            </Link>
          </>
        ) : (
          <div className="my-auto max-w-lg py-8">
            <h2 className="font-display text-3xl text-primary sm:text-4xl">You have room to think.</h2>
            <p className="mt-3 text-sm leading-relaxed text-secondary">
              There is no urgent appointment or task competing for your attention right now.
            </p>
          </div>
        )}
      </div>
    </article>
  );
}

export function Timeline({
  items,
  calendarConnected,
}: {
  items: TodayTimelineItem[];
  calendarConnected: boolean;
}) {
  return (
    <section className="atlas-panel rounded-3xl p-5 sm:p-6" aria-labelledby="today-schedule">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.13em] text-tertiary uppercase">Today</p>
          <h2 id="today-schedule" className="font-display mt-1 text-2xl text-primary">
            Schedule
          </h2>
        </div>
        <Link href="/calendar" className="text-sm text-accent-text hover:text-accent-hover">
          View calendar
        </Link>
      </div>

      {items.length > 0 ? (
        <ol className="mt-7 space-y-0">
          {items.map((item, index) => (
            <li key={item.id} className="relative grid grid-cols-[4.5rem_1fr] gap-4 pb-6 last:pb-0">
              {index < items.length - 1 ? (
                <span aria-hidden className="absolute top-4 bottom-0 left-[5.12rem] w-px bg-line-subtle" />
              ) : null}
              <time className="pt-0.5 text-xs font-medium text-tertiary">{item.time}</time>
              <div className="relative pl-5">
                <span
                  aria-hidden
                  className={cn(
                    'absolute top-1.5 left-0 size-2 rounded-full ring-4 ring-surface-raised',
                    item.active ? 'bg-accent' : 'bg-forest-400',
                  )}
                />
                <p className="text-sm font-medium text-primary">{item.title}</p>
                {item.detail ? <p className="mt-1 text-xs text-tertiary">{item.detail}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="mt-7 rounded-2xl border border-dashed border-line px-5 py-8">
          <CalendarDays aria-hidden className="size-5 text-accent-text" />
          <p className="mt-3 text-sm font-medium text-primary">
            {calendarConnected ? 'No events scheduled today' : 'Calendar not connected'}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-tertiary">
            {calendarConnected
              ? 'Your calendar is clear for the rest of the day.'
              : 'Connect Google in Settings to bring today’s agenda into Atlas.'}
          </p>
        </div>
      )}
    </section>
  );
}

export function AttentionGrid({ items }: { items: AttentionItem[] }) {
  return (
    <section aria-labelledby="attention-required">
      <div className="mb-4 flex items-center gap-3">
        <h2 id="attention-required" className="font-display text-2xl text-primary">
          Attention required
        </h2>
        <span aria-hidden className="h-px flex-1 bg-line-subtle" />
      </div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              href={item.href}
              className="atlas-panel group min-h-32 rounded-2xl p-4 transition-colors hover:border-line"
            >
              <div className="flex items-center justify-between gap-2">
                <Icon aria-hidden className="size-[1.05rem] text-accent-text" />
                <ArrowRight aria-hidden className="size-3.5 text-tertiary transition-transform group-hover:translate-x-0.5" />
              </div>
              <p
                className={cn(
                  'mt-5 text-2xl font-medium tabular-nums',
                  item.tone === 'attention' ? 'text-accent-text' : 'text-primary',
                )}
              >
                {item.value}
              </p>
              <p className="mt-0.5 text-sm text-secondary">{item.label}</p>
              <p className="mt-1 text-xs text-tertiary">{item.detail}</p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export function IntelligencePanel({ briefingEnabled }: { briefingEnabled: boolean }) {
  return (
    <section className="atlas-panel relative overflow-hidden rounded-3xl p-6 sm:p-7" aria-labelledby="daily-briefing">
      <div aria-hidden className="absolute top-0 right-0 h-full w-1/2 bg-[radial-gradient(circle_at_top_right,rgb(39_107_78/0.18),transparent_62%)]" />
      <div className="relative">
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs font-semibold tracking-[0.14em] text-accent-text uppercase">
            Atlas intelligence
          </p>
          <StatusBadge>{briefingEnabled ? 'Scheduled' : 'Off'}</StatusBadge>
        </div>
        <h2 id="daily-briefing" className="font-display mt-5 text-3xl text-primary">
          Your daily briefing
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-secondary">
          {briefingEnabled
            ? 'No briefing has been generated yet. When scheduled jobs are running, Atlas will bring together your agenda, tasks, reminders, approvals and intelligence here.'
            : 'Daily briefing is currently turned off. You can enable it from Settings when you want Atlas to prepare your morning.'}
        </p>
        <Link
          href="/settings"
          className="mt-6 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-accent-text hover:text-accent-hover"
        >
          {briefingEnabled ? 'Briefing settings' : 'Enable in Settings'}
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>
    </section>
  );
}

export function QuickActions() {
  const actions = [
    { label: 'Add task', href: '/tasks', icon: Plus },
    { label: 'Save memory', href: '/memory', icon: Sparkles },
    { label: 'Capture idea', href: '/ideas', icon: Lightbulb },
    { label: 'Record note', href: '/talk', icon: Mic },
  ] as const;

  return (
    <section aria-labelledby="quick-actions">
      <h2 id="quick-actions" className="mb-4 font-display text-2xl text-primary">
        Quick actions
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <Link
              key={action.href + action.label}
              href={action.href}
              className="atlas-panel group flex min-h-24 flex-col justify-between rounded-2xl p-4 text-sm font-medium text-primary transition-colors hover:border-line"
            >
              <Icon aria-hidden className="size-[1.1rem] text-accent-text" />
              <span className="flex items-center justify-between gap-2">
                {action.label}
                <ArrowRight aria-hidden className="size-3.5 text-tertiary transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export function buildAttentionItems(input: {
  pendingApprovals: number;
  overdueTasks: number;
  dueReminders: number;
  googleConnected: boolean;
}): AttentionItem[] {
  return [
    {
      label: 'Approvals',
      value: String(input.pendingApprovals),
      detail: input.pendingApprovals === 0 ? 'Nothing waiting' : 'Awaiting your decision',
      href: '/approvals',
      tone: input.pendingApprovals > 0 ? 'attention' : 'calm',
      icon: ShieldCheck,
    },
    {
      label: 'Overdue tasks',
      value: String(input.overdueTasks),
      detail: input.overdueTasks === 0 ? 'You are up to date' : 'Needs review today',
      href: '/tasks',
      tone: input.overdueTasks > 0 ? 'attention' : 'calm',
      icon: CheckSquare,
    },
    {
      label: 'Reminders',
      value: String(input.dueReminders),
      detail: input.dueReminders === 0 ? 'None due now' : 'Due now',
      href: '/reminders',
      tone: input.dueReminders > 0 ? 'attention' : 'calm',
      icon: BellRing,
    },
    {
      label: 'Inbox',
      value: input.googleConnected ? 'Ready' : '—',
      detail: input.googleConnected ? 'Open to review mail' : 'Google not connected',
      href: input.googleConnected ? '/inbox' : '/settings',
      icon: Inbox,
    },
  ];
}

export function StatusBadge({ children }: { children: string }) {
  return (
    <span className="inline-flex min-h-7 items-center rounded-full border border-line-subtle bg-surface-inset/60 px-3 text-[0.68rem] font-medium tracking-wide text-secondary">
      {children}
    </span>
  );
}
