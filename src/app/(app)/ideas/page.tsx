import { Lightbulb } from 'lucide-react';
import type { Metadata } from 'next';

import { EmptyState } from '@/components/ui/EmptyState';
import { Card, Page, Section } from '@/components/ui/Page';
import { IDEA_PIPELINE, groupIdeasByStatus, listIdeas } from '@/lib/data/ideas';
import { formatRelative } from '@/lib/time';
import type { IdeaStatus } from '@/types/database';

export const metadata: Metadata = { title: 'Ideas' };
export const dynamic = 'force-dynamic';

const STAGE_LABEL: Record<IdeaStatus, string> = {
  captured: 'Captured',
  exploring: 'Exploring',
  planned: 'Planned',
  building: 'Building',
  completed: 'Completed',
  parked: 'Parked',
  archived: 'Archived',
};

export default async function IdeasPage() {
  const ideas = await listIdeas();
  const grouped = groupIdeasByStatus(ideas);

  if (ideas.length === 0) {
    return (
      <Page title="Ideas" description="Captured thinking, from a first thought to a plan.">
        <EmptyState
          icon={Lightbulb}
          title="No ideas captured"
          description={'Tell Atlas “Capture this idea: …” in Talk. Atlas can turn it into a structured plan — or a Claude Code brief you can hand straight to an implementation session. Your original wording is always kept, never rewritten.'}
        />
      </Page>
    );
  }

  return (
    <Page
      title="Ideas"
      description={`${ideas.length} idea${ideas.length === 1 ? '' : 's'} in the pipeline.`}
    >
      {IDEA_PIPELINE.map((stage) => {
        const stageIdeas = grouped[stage] ?? [];
        if (stageIdeas.length === 0) return null;

        return (
          <Section key={stage} title={STAGE_LABEL[stage]}>
            <ul className="grid gap-3 sm:grid-cols-2">
              {stageIdeas.map((idea) => (
                <Card as="li" key={idea.id}>
                  <p className="text-sm font-medium text-primary">{idea.title}</p>
                  {/* The summary is shown when there is one, but the original
                      capture is what is stored and never overwritten. */}
                  <p className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-tertiary">
                    {idea.summary ?? idea.original_capture}
                  </p>
                  {idea.next_action ? (
                    <p className="mt-3 text-2xs text-accent-text">Next: {idea.next_action}</p>
                  ) : null}
                  <p className="mt-3 text-2xs text-tertiary">
                    Updated {formatRelative(new Date(idea.updated_at))}
                  </p>
                </Card>
              ))}
            </ul>
          </Section>
        );
      })}
    </Page>
  );
}
