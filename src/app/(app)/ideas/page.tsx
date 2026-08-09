import { Archive, ArrowRight, CheckCircle2, Clock3, Lightbulb, ListChecks, Sparkles } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/ui/EmptyState';
import { Card, Page, Section } from '@/components/ui/Page';
import { archiveIdeaFormAction, keepIdeaFormAction } from '@/features/ideas/actions';
import { IdeaCaptureForm } from '@/features/ideas/IdeaCaptureForm';
import { isStaleIdea, listIdeas } from '@/lib/data/ideas';
import { formatDateTime, formatRelative } from '@/lib/time';
import type { Idea } from '@/types/database';

export const metadata: Metadata = { title: 'Ideas & Planner' };
export const dynamic = 'force-dynamic';

function IdeaCard({ idea }: { idea: Idea }) {
  return (
    <Card as="li" className="group relative">
      <Link href={`/ideas/${idea.id}`} className="absolute inset-0 rounded-2xl" aria-label={`Open ${idea.title}`} />
      <div className="relative pointer-events-none">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-primary">{idea.title}</p>
            <p className="mt-1 text-2xs font-medium tracking-wide text-accent-text uppercase">
              {idea.status.replace('_', ' ')}
            </p>
          </div>
          <ArrowRight aria-hidden className="size-4 text-tertiary transition-transform group-hover:translate-x-0.5" />
        </div>
        <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-tertiary">
          {idea.understanding ?? idea.summary ?? idea.original_capture}
        </p>
        {idea.next_action ? (
          <div className="mt-4 rounded-xl border border-accent/15 bg-accent-muted/40 p-3">
            <p className="text-2xs font-semibold tracking-[0.12em] text-accent-text uppercase">Next action</p>
            <p className="mt-1 text-sm text-primary">{idea.next_action}</p>
            {idea.next_action_at ? (
              <p className="mt-1 flex items-center gap-1.5 text-2xs text-secondary">
                <Clock3 aria-hidden className="size-3" />
                {formatDateTime(new Date(idea.next_action_at))}
                {idea.next_action_duration_minutes ? ` · ${idea.next_action_duration_minutes} min` : ''}
              </p>
            ) : null}
          </div>
        ) : null}
        <p className="mt-4 text-2xs text-tertiary">Updated {formatRelative(new Date(idea.last_touched_at))}</p>
      </div>
    </Card>
  );
}

function IdeaSection({ title, ideas }: { title: string; ideas: Idea[] }) {
  if (!ideas.length) return null;
  return (
    <Section title={title}>
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {ideas.map((idea) => <IdeaCard key={idea.id} idea={idea} />)}
      </ul>
    </Section>
  );
}

export default async function IdeasPage() {
  const ideas = await listIdeas();
  const captured = ideas.filter((idea) => idea.status === 'captured');
  const active = ideas.filter((idea) => idea.status === 'planned' || idea.status === 'in_progress');
  const completed = ideas.filter((idea) => idea.status === 'completed');
  const archived = ideas.filter((idea) => idea.status === 'archived');
  const stale = ideas.filter((idea) => isStaleIdea(idea));

  return (
    <Page
      title="Ideas & Planner"
      description="Idea → Understand → Improve → Plan → Remind → Execute. Lightweight plans, always under your control."
    >
      <IdeaCaptureForm />

      {ideas.length === 0 ? (
        <EmptyState
          icon={Lightbulb}
          title="No ideas captured"
          description={'Capture one here or tell Atlas, “I have an idea.” Your original wording is preserved before planning begins.'}
        />
      ) : (
        <>
          <IdeaSection title="Ideas" ideas={captured} />
          <IdeaSection title="Active plans" ideas={active} />
          <IdeaSection title="Completed" ideas={completed} />
          <IdeaSection title="Archived" ideas={archived} />
        </>
      )}

      {stale.length ? (
        <Section
          title="Atlas // Idea cleanup"
          description="Untouched for 90 days. Atlas never removes these automatically."
        >
          <ul className="space-y-3">
            {stale.map((idea) => (
              <li key={idea.id} className="atlas-panel rounded-2xl p-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-primary">{idea.title}</p>
                  <p className="mt-1 text-xs text-tertiary">Quiet since {formatDateTime(new Date(idea.last_touched_at))}</p>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 sm:mt-0">
                  <form action={keepIdeaFormAction}>
                    <input type="hidden" name="ideaId" value={idea.id} />
                    <button className="min-h-10 rounded-lg border border-line px-3 text-xs text-secondary"><Sparkles aria-hidden className="mr-1.5 inline size-3.5" />Keep</button>
                  </form>
                  <form action={archiveIdeaFormAction}>
                    <input type="hidden" name="ideaId" value={idea.id} />
                    <button className="min-h-10 rounded-lg border border-line px-3 text-xs text-secondary"><Archive aria-hidden className="mr-1.5 inline size-3.5" />Archive</button>
                  </form>
                  <Link href={`/ideas/${idea.id}#idea-delete`} className="inline-flex min-h-10 items-center rounded-lg border border-critical/30 px-3 text-xs text-critical">Review delete</Link>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        {[
          { icon: Lightbulb, label: 'Capture', text: 'Original wording stays intact.' },
          { icon: ListChecks, label: 'Plan', text: 'Calendar-checked and approved once.' },
          { icon: CheckCircle2, label: 'Execute', text: 'One clear next action at a time.' },
        ].map(({ icon: Icon, label, text }) => (
          <div key={label} className="rounded-xl border border-line-subtle bg-surface-raised p-4">
            <Icon aria-hidden className="size-4 text-accent-text" />
            <p className="mt-3 text-sm font-medium text-primary">{label}</p>
            <p className="mt-1 text-xs text-tertiary">{text}</p>
          </div>
        ))}
      </div>
    </Page>
  );
}
