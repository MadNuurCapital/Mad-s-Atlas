import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { ResearchReport, ResearchSource } from '@/types/database';

export type ResearchReportWithSources = ResearchReport & { sources: ResearchSource[] };

export async function listResearchReports(limit = 20): Promise<ResearchReportWithSources[]> {
  const supabase = await createClient();
  const { data: reports, error } = await supabase
    .from('research_reports')
    .select('*')
    .order('searched_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 50));

  if (error) throw new Error(`Could not load research (${error.code ?? 'unknown'})`);
  if (!reports?.length) return [];

  const reportIds = reports.map((report) => report.id);
  const { data: sources, error: sourceError } = await supabase
    .from('research_sources')
    .select('*')
    .in('research_report_id', reportIds)
    .order('created_at', { ascending: true });

  if (sourceError) throw new Error(`Could not load research sources (${sourceError.code ?? 'unknown'})`);

  return (reports as ResearchReport[]).map((report) => ({
    ...report,
    sources: (sources ?? []).filter(
      (source) => source.research_report_id === report.id,
    ) as ResearchSource[],
  }));
}
