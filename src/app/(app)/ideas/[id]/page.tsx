import {
  BellRing,
  CalendarDays,
  CheckSquare,
  Clock3,
  FileText,
  Lightbulb,
  Link2,
  ListChecks,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Card, Page, Section } from '@/components/ui/Page';
import { ApprovalCard } from '@/features/approvals/ApprovalCard';
import {
  DeleteIdeaPanel,
  IdeaCommandBox,
  IdeaLifecycleActions,
  IdeaPlanButton,
} from '@/features/ideas/IdeaControls';
import { IdeaNotes } from '@/features/ideas/IdeaNotes';
import { IdeaSteps } from '@/features/ideas/IdeaSteps';
import { planExecutionPayloadSchema, type PlanExecutionPayload } from '@/lib/atlas/planner/model';
import { getApproval } from '@/lib/data/approvals';
import { getIdeaDetail } from '@/lib/data/ideas';
import { formatDateTime, formatRelative } from '@/lib/time';
import type { Idea, Json } from '@/types/database';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const detail = await getIdeaDetail(id);
  return { title: detail?.idea.title ?? 'Idea' };
}

function stringList(value: Json): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function draftPayload(idea: Idea): PlanExecutionPayload | null {
  const parsed = planExecutionPayloadSchema.safeParse(idea.structured_plan);
  return parsed.success && parsed.data.ideaId === idea.id ? parsed.data : null;
}

export default async function IdeaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getIdeaDetail(id);
  if (!detail) notFound();

  const approval = await getApproval(detail.idea.pending_approval_id);
  const draft = draftPayload(detail.idea);
  const instructions = stringList(detail.idea.instructions);
  const activeSteps = detail.steps.filter((step) => step.status !== 'skipped');
  const currentStep = activeSteps.find((step) => step.status === 'in_progress')
    ?? activeSteps.find((step) => step.status === 'pending');
  const calendarEvents = detail.steps.filter((step) => step.google_calendar_event_id).length;

  return (
    <Page
      title={detail.idea.title}
      description={`Atlas Idea · ${detail.idea.status.replace('_', ' ')} · Updated ${formatRelative(new Date(detail.idea.last_touched_at))}`}
      actions={<IdeaPlanButton ideaId={detail.idea.id} hasPlan={Boolean(detail.idea.plan_version || detail.steps.length)} />}
    >
      <div className="mb-6">
        <Link href="/ideas" className="text-sm text-accent-text hover:text-accent-hover">← All Ideas</Link>
      </div>

      <section className="atlas-panel-emphasis atlas-corners mb-8 overflow-hidden rounded-3xl p-6 sm:p-7" aria-labelledby="next-plan-action">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.14em] text-accent-text uppercase">Next action</p>
            <h2 id="next-plan-action" className="font-display mt-3 text-3xl text-primary">
              {detail.idea.next_action ?? 'Plan the next move'}
            </h2>
            {detail.idea.next_action_at ? (
              <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-secondary">
                <Clock3 aria-hidden className="size-4 text-accent-text" />
                {formatDateTime(new Date(detail.idea.next_action_at))}
                {detail.idea.next_action_duration_minutes ? ` · ${detail.idea.next_action_duration_minutes} minutes` : ''}
              </p>
            ) : (
              <p className="mt-3 text-sm text-secondary">
                {detail.idea.status === 'captured'
                  ? 'Ask Atlas to turn this captured thought into a calendar-checked plan.'
                  : 'There is no unfinished scheduled action.'}
              </p>
            )}
          </div>
          <span className="rounded-full border border-accent/25 bg-accent-muted px-3 py-1.5 text-2xs font-semibold tracking-wide text-accent-text uppercase">
            {detail.idea.status.replace('_', ' ')}
          </span>
        </div>
      </section>

      {approval && (approval.status === 'pending' || approval.status === 'approved') ? (
        <Section title="Plan approval" description="One approval creates every selected Task, Calendar block and Reminder together.">
          <ApprovalCard approval={approval} />
        </Section>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(20rem,0.7fr)]">
        <div>
          <Section title="Atlas understanding">
            <Card>
              <Sparkles aria-hidden className="size-4 text-accent-text" />
              <p className="mt-3 text-sm leading-relaxed text-secondary">
                {detail.idea.understanding ?? 'Atlas has preserved the Idea and is waiting to prepare its understanding.'}
              </p>
            </Card>
          </Section>

          <Section title="My instructions">
            <Card>
              {instructions.length ? (
                <ul className="space-y-2 text-sm text-secondary">
                  {instructions.map((instruction) => <li key={instruction} className="flex gap-2"><span className="text-accent-text">•</span><span>{instruction}</span></li>)}
                </ul>
              ) : <p className="text-sm text-tertiary">No separate constraints recorded yet.</p>}
              {draft?.assumptions.length ? (
                <div className="mt-4 border-t border-line-subtle pt-4">
                  <p className="text-2xs font-semibold tracking-wide text-tertiary uppercase">Atlas assumptions</p>
                  <ul className="mt-2 space-y-1 text-xs text-tertiary">
                    {draft.assumptions.map((assumption) => <li key={assumption}>• {assumption}</li>)}
                  </ul>
                </div>
              ) : null}
            </Card>
          </Section>

          <Section title="Atlas plan" description="Completed steps stay fixed when Atlas re-plans unfinished work.">
            {activeSteps.length ? (
              <IdeaSteps ideaId={detail.idea.id} steps={activeSteps} />
            ) : draft?.steps.length ? (
              <div className="space-y-3">
                {draft.steps.map((step, index) => (
                  <Card key={`${step.title}-${index}`}>
                    <p className="text-2xs font-medium text-accent-text">Proposed step {index + 1}</p>
                    <p className="mt-1 text-sm font-medium text-primary">{step.title}</p>
                    {step.description ? <p className="mt-1 text-sm text-tertiary">{step.description}</p> : null}
                    <p className="mt-2 text-xs text-secondary">
                      {step.scheduledStart ? formatDateTime(new Date(step.scheduledStart)) : 'Unscheduled'} · {step.durationMinutes} min
                    </p>
                  </Card>
                ))}
              </div>
            ) : (
              <Card>
                <ListChecks aria-hidden className="size-4 text-accent-text" />
                <p className="mt-3 text-sm text-tertiary">No plan steps yet.</p>
              </Card>
            )}
          </Section>

          <Section title="Notes" description="Idea-specific context. Nothing here enters global Memory automatically.">
            <IdeaNotes ideaId={detail.idea.id} notes={detail.notes} />
          </Section>
        </div>

        <aside>
          <Section title="Plan controls">
            <IdeaCommandBox ideaId={detail.idea.id} />
            <div className="mt-3"><IdeaLifecycleActions ideaId={detail.idea.id} status={detail.idea.status} /></div>
          </Section>

          <Section title="Related">
            <div className="space-y-2">
              <Link href="/tasks" className="atlas-panel flex min-h-14 items-center justify-between rounded-xl px-4 text-sm text-secondary">
                <span className="flex items-center gap-2"><CheckSquare aria-hidden className="size-4 text-accent-text" />Tasks</span>
                <span>{detail.tasks.length}</span>
              </Link>
              <Link href="/calendar" className="atlas-panel flex min-h-14 items-center justify-between rounded-xl px-4 text-sm text-secondary">
                <span className="flex items-center gap-2"><CalendarDays aria-hidden className="size-4 text-accent-text" />Calendar blocks</span>
                <span>{calendarEvents}</span>
              </Link>
              <Link href="/reminders" className="atlas-panel flex min-h-14 items-center justify-between rounded-xl px-4 text-sm text-secondary">
                <span className="flex items-center gap-2"><BellRing aria-hidden className="size-4 text-accent-text" />Reminders</span>
                <span>{detail.reminders.length}</span>
              </Link>
            </div>
          </Section>

          <Section title="Current plan state">
            <Card>
              <dl className="space-y-3 text-xs">
                <div className="flex justify-between gap-3"><dt className="text-tertiary">Plan version</dt><dd className="text-secondary">{detail.idea.plan_version || 'Draft'}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-tertiary">Completed steps</dt><dd className="text-secondary">{activeSteps.filter((step) => step.status === 'completed').length}/{activeSteps.length}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-tertiary">Current step</dt><dd className="max-w-40 text-right text-secondary">{currentStep?.title ?? 'None'}</dd></div>
              </dl>
            </Card>
          </Section>

          <DeleteIdeaPanel
            ideaId={detail.idea.id}
            linkedTasks={detail.tasks.length}
            linkedReminders={detail.reminders.length}
            linkedCalendarEvents={calendarEvents}
          />
        </aside>
      </div>

      <Section title="Original idea" description="Preserved exactly as captured. Atlas cannot overwrite it.">
        <Card>
          <div className="flex items-center gap-2 text-accent-text"><Lightbulb aria-hidden className="size-4" /><span className="text-2xs font-semibold tracking-wide uppercase">Original capture</span></div>
          <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-secondary">{detail.idea.original_capture}</p>
          <p className="mt-4 text-2xs text-tertiary">Captured {formatDateTime(new Date(detail.idea.created_at))}</p>
        </Card>
      </Section>

      <div className="mt-6 flex items-center gap-2 text-xs text-tertiary">
        <ShieldCheck aria-hidden className="size-4 text-positive" />
        Planning drafts cannot create linked items until you approve them.
        <MessageSquareText aria-hidden className="ml-2 size-4" />
        Voice and text update the same Idea object.
        <FileText aria-hidden className="ml-2 size-4" />
        Notes remain local to this Idea.
        <Link2 aria-hidden className="ml-2 size-4" />
        Linked records stay traceable.
      </div>
    </Page>
  );
}
