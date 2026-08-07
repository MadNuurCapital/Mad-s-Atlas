import 'server-only';

import { researchCurrentWeb, type ResearchOutcome } from '@/lib/atlas/research/provider';
import { createAdminClient } from '@/lib/supabase/admin';

export type StoredResearchOutcome = ResearchOutcome & { reportId: string };

export async function runAndStoreResearch(
  userId: string,
  query: string,
): Promise<StoredResearchOutcome> {
  const outcome = await researchCurrentWeb(query);
  const admin = createAdminClient();
  const { data: report, error } = await admin
    .from('research_reports')
    .insert({
      user_id: userId,
      query: outcome.query,
      summary: outcome.summary || 'No grounded summary was returned.',
      why_it_matters: outcome.caveat,
      structured_result: {
        unverified: outcome.unverified,
        caveat: outcome.caveat,
      },
      searched_at: outcome.searchedAt,
    })
    .select('id')
    .single();

  if (error || !report) throw new Error('report_insert_failed');

  if (outcome.sources.length > 0) {
    const { error: sourceError } = await admin.from('research_sources').insert(
      outcome.sources.map((source) => ({
        research_report_id: report.id,
        user_id: userId,
        title: source.title,
        publisher: source.publisher,
        source_url: source.url,
        publication_date: source.publicationDate,
        accessed_at: outcome.searchedAt,
      })),
    );

    if (sourceError) {
      await admin.from('research_reports').delete().eq('id', report.id).eq('user_id', userId);
      throw new Error('source_insert_failed');
    }
  }

  return { ...outcome, reportId: report.id };
}
