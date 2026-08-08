'use client';

import { Circle, CircleCheck, RotateCcw } from 'lucide-react';
import { useOptimistic, useTransition } from 'react';

import { completeTask, reopenTask } from '@/features/tasks/actions';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/time';
import type { Task, TaskPriority } from '@/types/database';

const PRIORITY_STYLES: Record<TaskPriority, string> = {
  critical: 'text-critical',
  high: 'text-caution',
  normal: 'text-tertiary',
  low: 'text-tertiary',
};

export function TaskList({
  tasks,
  emptyMessage,
  showDue = true,
}: {
  tasks: Task[];
  emptyMessage: string;
  showDue?: boolean;
}) {
  // Optimistic completion: the checkbox responds immediately and reverts if
  // the server rejects it, rather than freezing for a round trip.
  const [optimisticTasks, toggleOptimistic] = useOptimistic(
    tasks,
    (current: Task[], id: string) =>
      current.map((task) =>
        task.id === id
          ? { ...task, status: task.status === 'completed' ? 'inbox' : 'completed' }
          : task,
      ),
  );

  const [, startTransition] = useTransition();

  if (optimisticTasks.length === 0) {
    return <p className="px-1 py-3 text-sm text-tertiary">{emptyMessage}</p>;
  }

  function toggle(task: Task) {
    const formData = new FormData();
    formData.set('id', task.id);

    startTransition(async () => {
      toggleOptimistic(task.id);
      if (task.status === 'completed') {
        await reopenTask(formData);
      } else {
        await completeTask(formData);
      }
    });
  }

  return (
    <ul className="divide-y divide-line-subtle">
      {optimisticTasks.map((task) => {
        const done = task.status === 'completed' || task.status === 'cancelled';

        return (
          <li key={task.id} className="flex items-start gap-3 py-3">
            <button
              type="button"
              onClick={() => toggle(task)}
              // A 44px target: the row is compact, but the control is not.
              className="-my-2 -ml-2 grid size-11 shrink-0 place-items-center rounded-full text-tertiary transition-colors hover:bg-surface-overlay hover:text-accent-text"
              aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
            >
              {done ? (
                <CircleCheck aria-hidden className="size-5 text-positive" />
              ) : (
                <Circle aria-hidden className="size-5" />
              )}
            </button>

            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  'text-sm leading-snug',
                  done ? 'text-tertiary line-through' : 'text-primary',
                )}
              >
                {task.title}
              </p>

              {task.description ? (
                <p className="mt-0.5 line-clamp-2 text-sm text-tertiary">{task.description}</p>
              ) : null}

              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs">
                {showDue && task.due_at ? (
                  <span className="text-tertiary">
                    {formatDateTime(new Date(task.due_at))}
                  </span>
                ) : null}

                {task.priority !== 'normal' ? (
                  <span className={cn('font-medium capitalize', PRIORITY_STYLES[task.priority])}>
                    {task.priority}
                  </span>
                ) : null}

                {task.related_project ? (
                  <span className="text-tertiary">{task.related_project}</span>
                ) : null}
              </div>
            </div>

            {done ? (
              <RotateCcw aria-hidden className="mt-1 size-3.5 shrink-0 text-tertiary opacity-0" />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
