import type { Metadata } from 'next';

import { Page, Section } from '@/components/ui/Page';
import { AddTask } from '@/features/tasks/AddTask';
import { TaskList } from '@/features/tasks/TaskList';
import { bucketTasks, listTasks } from '@/lib/data/tasks';

export const metadata: Metadata = { title: 'Tasks' };
export const dynamic = 'force-dynamic';

export default async function TasksPage() {
  const tasks = await listTasks();
  const buckets = bucketTasks(tasks);

  const openCount =
    buckets.overdue.length +
    buckets.today.length +
    buckets.upcoming.length +
    buckets.someday.length;

  return (
    <Page
      title="Tasks"
      description={
        openCount === 0
          ? 'Nothing open.'
          : `${openCount} open${
              buckets.overdue.length > 0 ? ` · ${buckets.overdue.length} overdue` : ''
            }`
      }
    >
      <AddTask />

      {buckets.overdue.length > 0 ? (
        <Section title="Overdue">
          <TaskList tasks={buckets.overdue} emptyMessage="Nothing overdue." />
        </Section>
      ) : null}

      <Section title="Today">
        <TaskList tasks={buckets.today} emptyMessage="Nothing due today." />
      </Section>

      <Section title="Upcoming">
        <TaskList tasks={buckets.upcoming} emptyMessage="Nothing scheduled ahead." />
      </Section>

      <Section title="No date">
        <TaskList tasks={buckets.someday} emptyMessage="Everything has a date." showDue={false} />
      </Section>

      {buckets.completed.length > 0 ? (
        <Section title="Recently completed">
          <TaskList tasks={buckets.completed.slice(0, 20)} emptyMessage="" />
        </Section>
      ) : null}
    </Page>
  );
}
