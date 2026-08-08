import type { Metadata } from 'next';
import { Suspense } from 'react';

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
import { getLatestBriefing } from '@/lib/data/briefings';
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

async function loadWorkDay(now: Date) {
  const [tasks, reminders] = await Promise.all([
    listTasks(),
    listReminders(),
  ]);

  return {
    taskBuckets: bucketTasks(tasks, now),
    reminderBuckets: bucketReminders(reminders, now),
  };
}

async function loadCalendarDay(now: Date) {
  const [{ user }, connection] = await Promise.all([requireOwner(), getConnectionStatus()]);
  const connected = connection?.connectionStatus === 'connected';
  if (!connected) return { connected, events: [] as CalendarEvent[] };

  const [year, month, day] = localDateKey(now).split('-').map(Number);
  if (!year || !month || !day) return { connected, events: [] as CalendarEvent[] };

  const start = zonedTimeToUtc(year, month, day, 0, 0);
  const end = zonedTimeToUtc(year, month, day + 1, 0, 0);
  const result = await listEvents(user.id, start, end);
  return { connected, events: result.ok ? result.data : [] };
}

type WorkDay = Awaited<ReturnType<typeof loadWorkDay>>;
type CalendarDay = Awaited<ReturnType<typeof loadCalendarDay>>;

async function PreferredName({ profile }: { profile: ReturnType<typeof getProfile> }) {
  return (await profile)?.preferred_name ?? 'Mad';
}

async function PriorityPanel({ data }: { data: Promise<WorkDay> }) {
  const { taskBuckets } = await data;
  const priorityTask = [...taskBuckets.overdue, ...taskBuckets.today].sort((a, b) => {
    const rank = { critical: 0, high: 1, normal: 2, low: 3 } as const;
    return rank[a.priority] - rank[b.priority];
  })[0];

  return <HeroPriority priority={priorityFrom(undefined, priorityTask)} />;
}

async function SchedulePanel({ data, now }: { data: Promise<CalendarDay>; now: Date }) {
  const { connected, events } = await data;
  const upcomingEvents = events.filter((event) => event.allDay || new Date(event.end) >= now);
  const timeline: TodayTimelineItem[] = upcomingEvents.map((event) => ({
    id: event.id,
    time: event.allDay ? 'All day' : formatTime(new Date(event.start)),
    title: event.summary,
    detail: event.location ?? undefined,
    active: !event.allDay && new Date(event.start) <= now && new Date(event.end) >= now,
  }));

  return <Timeline items={timeline} calendarConnected={connected} />;
}

async function AttentionPanel({
  data,
  approvals,
}: {
  data: Promise<WorkDay>;
  approvals: ReturnType<typeof listApprovals>;
}) {
  const [{ taskBuckets, reminderBuckets }, resolvedApprovals] = await Promise.all([
    data,
    approvals,
  ]);
  const approvalBuckets = partitionApprovals(resolvedApprovals);
  return (
    <AttentionGrid
      items={buildAttentionItems({
        pendingApprovals: approvalBuckets.pending.length,
        overdueTasks: taskBuckets.overdue.length,
        dueReminders: reminderBuckets.due.length,
      })}
    />
  );
}

async function BriefingPanel({
  profile,
  briefing,
}: {
  profile: ReturnType<typeof getProfile>;
  briefing: ReturnType<typeof getLatestBriefing>;
}) {
  const [resolvedProfile, resolvedBriefing] = await Promise.all([profile, briefing]);
  return (
    <IntelligencePanel
      briefingEnabled={Boolean(resolvedProfile?.briefing_enabled)}
      briefing={resolvedBriefing}
    />
  );
}

function PanelSkeleton({ label, tall = false }: { label: string; tall?: boolean }) {
  return (
    <div
      role="status"
      aria-label={`Loading ${label}`}
      className={`atlas-panel atlas-skeleton rounded-3xl p-6 ${tall ? 'min-h-[18rem]' : 'min-h-40'}`}
    >
      <span className="text-2xs font-semibold tracking-[0.14em] text-tertiary uppercase">
        Loading {label}
      </span>
    </div>
  );
}

export default function TodayPage() {
  const now = new Date();
  const workDay = loadWorkDay(now);
  const approvals = listApprovals();
  const calendarDay = loadCalendarDay(now);
  const profile = getProfile();
  const briefing = getLatestBriefing();

  return (
    <div className="mx-auto w-full max-w-[90rem] px-4 py-6 sm:px-7 lg:px-9 lg:py-8 xl:px-11">
      <header className="mb-7 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="mb-3 text-xs font-semibold tracking-[0.16em] text-accent-text uppercase">
            {formatLongDate(now)} · Singapore
          </p>
          <h1 className="font-display text-[2.4rem] leading-[1.06] text-primary sm:text-5xl">
            {greeting(now)},{' '}
            <Suspense fallback="Mad">
              <PreferredName profile={profile} />
            </Suspense>
            .
          </h1>
          <p className="mt-3 text-sm text-secondary sm:text-base">
            Atlas is assembling what deserves your attention.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-secondary">
          <span aria-hidden className="size-2 rounded-full bg-positive shadow-[0_0_12px_rgb(61_140_104/0.7)]" />
          Atlas is ready
        </div>
      </header>

      <CommandBar />

      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(20rem,0.8fr)]">
        <Suspense fallback={<PanelSkeleton label="priorities" tall />}>
          <PriorityPanel data={workDay} />
        </Suspense>
        <Suspense fallback={<PanelSkeleton label="calendar" tall />}>
          <SchedulePanel data={calendarDay} now={now} />
        </Suspense>
      </div>

      <div className="mt-8">
        <Suspense fallback={<PanelSkeleton label="attention" />}>
          <AttentionPanel data={workDay} approvals={approvals} />
        </Suspense>
      </div>

      <div className="mt-8 grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(20rem,0.8fr)]">
        <Suspense fallback={<PanelSkeleton label="intelligence" />}>
          <BriefingPanel profile={profile} briefing={briefing} />
        </Suspense>
        <QuickActions />
      </div>
    </div>
  );
}
