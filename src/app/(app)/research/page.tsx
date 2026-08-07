import { ExternalLink, Search } from 'lucide-react';
import type { Metadata } from 'next';

import { EmptyState } from '@/components/ui/EmptyState';
import { Card, Page, Section } from '@/components/ui/Page';
import { ResearchForm } from '@/features/research/ResearchForm';
import { listResearchReports } from '@/lib/data/research';
import { formatRelative } from '@/lib/time';

export const metadata: Metadata = { title: 'Research' };
export const dynamic = 'force-dynamic';

export default async function ResearchPage() {
  const reports = await listResearchReports();

  return (
    <Page
      title="Research"
      description="Grounded intelligence for decisions, projects and your daily briefing."
    >
      <ResearchForm />

      <Section title="Recent research" className="mt-8">
        {reports.length === 0 ? (
          <EmptyState
            icon={Search}
            title="No research saved yet"
            description="Ask Atlas to investigate a current topic. The report and its real sources will appear here."
          />
        ) : (
          <ul className="space-y-4">
            {reports.map((report) => {
              const structured = report.structured_result as { unverified?: boolean; caveat?: string | null };
              return (
                <Card as="li" key={report.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <h2 className="font-display text-xl text-primary">{report.query}</h2>
                    <span className="text-2xs text-tertiary">
                      {formatRelative(new Date(report.searched_at))}
                    </span>
                  </div>
                  <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-secondary">
                    {report.summary}
                  </p>
                  {structured.caveat ? (
                    <p className="mt-4 rounded-lg border border-caution/25 bg-caution/5 px-3 py-2 text-xs text-caution">
                      {structured.caveat}
                    </p>
                  ) : null}
                  {report.sources.length > 0 ? (
                    <div className="mt-5 border-t border-line-subtle pt-4">
                      <p className="text-2xs font-semibold tracking-[0.12em] text-tertiary uppercase">
                        Sources
                      </p>
                      <ul className="mt-2 space-y-2">
                        {report.sources.map((source) => (
                          <li key={source.id}>
                            <a
                              href={source.source_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-start gap-2 text-sm text-accent-text hover:text-accent-hover"
                            >
                              <span>{source.title}</span>
                              <ExternalLink aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                            </a>
                            {source.publisher ? (
                              <span className="ml-2 text-2xs text-tertiary">{source.publisher}</span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </Card>
              );
            })}
          </ul>
        )}
      </Section>
    </Page>
  );
}
