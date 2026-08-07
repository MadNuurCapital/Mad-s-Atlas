import type { Metadata } from 'next';

import {
  AttentionGrid,
  buildAttentionItems,
  CommandBar,
  HeroPriority,
  IntelligencePanel,
  QuickActions,
  Timeline,
  type TodayPriority,
  type TodayTimelineItem,
} from '@/components/today/TodayDashboard';
import { requireOwner } from '@/lib/auth/owner';
import { listApprovals, partitionApprovals } from '@/lib/data/approvals';
import { listReminders, bucketReminders } from '@/lib/data/reminders';
import { getConnectionStatus, getProfile } from '@/lib/data/settings';
import { bucketTasks, listTasks } from '@/lib/data/tasks';
import { listEvents, type CalendarEvent } from '@/lib/google/calendar';
import {
  ATLAS_DEFAULT_TIMEZONE,
  formatLongDate,
  formatTime,
  localDateKey,
  zonedTimeToUtc,
} from '@/lib/time';
import type { Task } from '@/types/database';

export const metadata: Metadata = { title: 'Today' };
export const dynamic = 'force-dynamic';

function greeting(date: Date): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-SG', {
      hour: '2-digit',
      hourCycle: 'h23',
      timeZone: ATLAS_DEFAULT_TIMEZONE,
    }).format(date),
  );

  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function priorityFrom(event: CalendarEvent | undefined, task: Task | undefined): TodayPriority | null {
  if (event) {
    return {
      eyebrow: 'Next appointment',
      title: event.summary,
      time: event.allDay ? 'All day' : formatTime(new Date(event.start)),
      context: event.location ?? event.description ?? undefined,
      href: '/calendar',
      action: 'Open calendar',
    };
  }

  if (task) {
    return {
      eyebrow: task.due_at && new Date(task.due_at) < new Date() ? 'Overdue priority' : 'Top priority',
      title: task.title,
      time: task.due_at ? formatTime(new Date(task.due_at)) : undefined,
      context: task.description ?? task.related_project ?? undefined,
      href: '/tasks',
      action: 'Review task',
    };
  }

  return null;
}

export default async function TodayPage() {
  const now = new Date();
  const { user } = await requireOwner();

  const [tasks, reminders, approvals, connection, profile] = await Promise.all([
    listTasks(),
    listReminders(),
    listApprovals(),
    getConnectionStatus(),
    getProfile(),
  ]);

  const taskBuckets = bucketTasks(tasks, now);
  const reminderBuckets = bucketReminders(reminders, now);
  const approvalBuckets = partitionApprovals(approvals);
  const googleConnected = connection?.connectionStatus === 'connected';

  let events: CalendarEvent[] = [];
  if (googleConnected) {
    const [year, month, day] = localDateKey(now).split('-').map(Number);
    if (year && month && day) {
      const start = zonedTimeToUtc(year, month, day, 0, 0);
      const end = zonedTimeToUtc(year, month, day + 1, 0, 0);
      const result = await listEvents(user.id, start, end);
      if (result.ok) events = result.data;
    }
  }

  const upcomingEvents = events.filter((event) => event.allDay || new Date(event.end) >= now);
  const priorityTask = [...taskBuckets.overdue, ...taskBuckets.today]
    .sort((a, b) => {
      const rank = { critical: 0, high: 1, normal: 2, low: 3 } as const;
      return rank[a.priority] - rank[b.priority];
    })[0];
  const priority = priorityFrom(upcomingEvents[0], priorityTask);

  const timeline: TodayTimelineItem[] = upcomingEvents.map((event) => ({
    id: event.id,
    time: event.allDay ? 'All day' : formatTime(new Date(event.start)),
    title: event.summary,
    detail: event.location ?? undefined,
    active: !event.allDay && new Date(event.start) <= now && new Date(event.end) >= now,
  }));

  const attention = buildAttentionItems({
    pendingApprovals: approvalBuckets.pending.length,
    overdueTasks: taskBuckets.overdue.length,
    dueReminders: reminderBuckets.due.length,
    googleConnected,
  });

  return (
    <div className="mx-auto w-full max-w-[90rem] px-4 py-6 sm:px-7 lg:px-9 lg:py-8 xl:px-11">
      <header className="mb-7 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="mb-3 text-xs font-semibold tracking-[0.16em] text-accent-text uppercase">
            {formatLongDate(now)} · Singapore
          </p>
          <h1 className="font-display text-[2.4rem] leading-[1.06] text-primary sm:text-5xl">
            {greeting(now)}, Muhammad.
          </h1>
          <p className="mt-3 text-sm text-secondary sm:text-base">
            {priority ? 'Atlas has prepared what needs your attention.' : 'Your day is calm and clear.'}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-secondary">
          <span aria-hidden className="size-2 rounded-full bg-positive shadow-[0_0_12px_rgb(61_140_104/0.7)]" />
          Atlas is ready
        </div>
      </header>

      <CommandBar />

      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(20rem,0.8fr)]">
        <HeroPriority priority={priority} />
        <Timeline items={timeline} calendarConnected={googleConnected} />
      </div>

      <div className="mt-8">
        <AttentionGrid items={attention} />
      </div>

      <div className="mt-8 grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(20rem,0.8fr)]">
        <IntelligencePanel briefingEnabled={Boolean(profile?.briefing_enabled)} />
        <QuickActions />
      </div>
    </div>
  );
}
