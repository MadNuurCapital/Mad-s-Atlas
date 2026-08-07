import { Sparkles } from 'lucide-react';
import type { Metadata } from 'next';

import { EmptyState } from '@/components/ui/EmptyState';
import { Page, Section } from '@/components/ui/Page';
import { MemoryList } from '@/features/memory/MemoryList';
import { MemorySearch } from '@/features/memory/MemorySearch';
import { countMemories, listMemories, listSuggestedMemories } from '@/lib/data/memories';
import type { MemoryCategory } from '@/types/database';

export const metadata: Metadata = { title: 'Memory' };
export const dynamic = 'force-dynamic';

const CATEGORIES: MemoryCategory[] = [
  'profile', 'preference', 'goal', 'routine', 'important_person',
  'project', 'commitment', 'decision', 'idea_reference', 'temporary_context',
];

export default async function MemoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string }>;
}) {
  const params = await searchParams;
  const category = CATEGORIES.includes(params.category as MemoryCategory)
    ? (params.category as MemoryCategory)
    : undefined;

  const [suggested, confirmed, counts] = await Promise.all([
    listSuggestedMemories(),
    listMemories({ status: 'confirmed', category, search: params.q }),
    countMemories(),
  ]);

  return (
    <Page
      title="Memory"
      description={
        counts.confirmed === 0
          ? 'Nothing remembered yet. Atlas can remember stable facts and plans from your conversations.'
          : `${counts.confirmed} confirmed${counts.suggested > 0 ? ` · ${counts.suggested} awaiting review` : ''}`
      }
    >
      {suggested.length > 0 ? (
        <Section
          title="Awaiting your review"
          description="Atlas suggested these. They are not used to inform answers until you confirm them."
        >
          <MemoryList memories={suggested} mode="review" />
        </Section>
      ) : null}

      <MemorySearch categories={CATEGORIES} />

      <Section title="Confirmed">
        {confirmed.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title={params.q || category ? 'Nothing matches' : 'Nothing remembered yet'}
            description={
              params.q || category
                ? 'Try a different search or category.'
                : 'Confirmed memories appear here. You can search, edit, supersede, export or delete any of it at any time.'
            }
          />
        ) : (
          <MemoryList memories={confirmed} mode="confirmed" />
        )}
      </Section>
    </Page>
  );
}
