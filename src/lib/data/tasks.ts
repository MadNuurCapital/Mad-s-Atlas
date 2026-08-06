import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { Task, TaskStatus } from '@/types/database';

/**
 * Task reads.
 *
 * Every query here goes through the request-scoped client, so Row Level
 * Security applies and `user_id` never needs to be passed in — the database
 * already knows who is asking. A function here that took a userId parameter
 * would be a sign something had gone wrong.
 */

const OPEN_STATUSES: TaskStatus[] = ['inbox', 'planned', 'in_progress', 'waiting'];

export type TaskBuckets = {
  overdue: Task[];
  today: Task[];
  upcoming: Task[];
  someday: Task[];
  completed: Task[];
};

export async function listTasks(): Promise<Task[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .is('deleted_at', null)
    .order('due_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Could not load tasks (${error.code ?? 'unknown'})`);
  return (data ?? []) as Task[];
}

/**
 * Group tasks the way the Tasks screen shows them.
 *
 * Bucketing happens here rather than in five separate queries: one round trip
 * is cheaper, and it guarantees the buckets are a partition of the same
 * snapshot rather than five reads that could disagree.
 */
export function bucketTasks(tasks: Task[], now = new Date()): TaskBuckets {
  const startOfTomorrow = new Date(now);
  startOfTomorrow.setHours(24, 0, 0, 0);

  const buckets: TaskBuckets = {
    overdue: [],
    today: [],
    upcoming: [],
    someday: [],
    completed: [],
  };

  for (const task of tasks) {
    if (task.status === 'completed' || task.status === 'cancelled') {
      buckets.completed.push(task);
      continue;
    }

    if (!task.due_at) {
      buckets.someday.push(task);
      continue;
    }

    const due = new Date(task.due_at);
    if (due < now) buckets.overdue.push(task);
    else if (due < startOfTomorrow) buckets.today.push(task);
    else buckets.upcoming.push(task);
  }

  return buckets;
}

export async function countOpenTasks(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .is('deleted_at', null)
    .in('status', OPEN_STATUSES);

  if (error) return 0;
  return count ?? 0;
}

/** Overdue tasks, via the security-definer function rather than a raw filter. */
export async function listOverdueTasks(): Promise<
  Array<{ id: string; title: string; priority: string; due_at: string }>
> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_overdue_tasks', { p_limit: 50 });

  if (error) throw new Error(`Could not load overdue tasks (${error.code ?? 'unknown'})`);
  return data ?? [];
}
