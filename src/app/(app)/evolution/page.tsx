import { Activity, BrainCircuit, Lightbulb, RotateCcw, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';

import { EmptyState } from '@/components/ui/EmptyState';
import { Card, Page, Section } from '@/components/ui/Page';
import { AdaptationRevert, CopyProposal, LearningReview, ResetLearning as ResetLearningButton } from '@/features/evolution/EvolutionControls';
import { getEvolutionDashboard } from '@/lib/data/evolution';
import { formatRelative } from '@/lib/time';

export const metadata: Metadata = { title: 'Evolution' };
export const dynamic = 'force-dynamic';

function Confidence({ value, status }: { value: number; status: string }) {
  return <span className="rounded-full border border-line px-2 py-1 text-2xs text-tertiary">{status} · {Math.round(value * 100)}%</span>;
}

export default async function EvolutionPage() {
  const { items, adaptations, metrics, proposals } = await getEvolutionDashboard();
  const learned = items.filter((item) => item.status === 'confirmed' || item.status === 'active');
  const recent = items.filter((item) => item.status !== 'confirmed' && item.status !== 'active');

  return (
    <Page title="Evolution" description="What Atlas is learning, why it believes it, and how the system is improving. You stay in control.">
      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        <Card><BrainCircuit className="mb-3 size-5 text-accent" /><p className="text-2xl text-primary">{learned.length}</p><p className="text-xs text-tertiary">confirmed patterns</p></Card>
        <Card><Activity className="mb-3 size-5 text-accent" /><p className="text-2xl text-primary">{metrics.filter((m) => m.health_status === 'healthy').length}</p><p className="text-xs text-tertiary">healthy signals</p></Card>
        <Card><Lightbulb className="mb-3 size-5 text-accent" /><p className="text-2xl text-primary">{proposals.length}</p><p className="text-xs text-tertiary">reviewable opportunities</p></Card>
      </div>

      <Section title="What Atlas has learned about me" description="Only items you confirmed, or workflows you explicitly activated.">
        {learned.length === 0 ? <EmptyState icon={BrainCircuit} title="No confirmed learning yet" description="Atlas will surface repeated evidence here for your review. It will not invent a profile from weak signals." /> : (
          <div className="grid gap-3 lg:grid-cols-2">{learned.map((item) => <Card key={item.id} as="article"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium text-primary">{item.title}</p><p className="mt-2 text-sm leading-relaxed text-secondary">{item.summary}</p></div><Confidence value={item.confidence} status={item.status} /></div><p className="mt-3 text-2xs text-tertiary">{item.evidence_count} evidence signal{item.evidence_count === 1 ? '' : 's'} · reinforced {formatRelative(new Date(item.last_reinforced_at))}</p><LearningReview id={item.id} canConfirm={false} /></Card>)}</div>
        )}
      </Section>

      <Section title="Recent learning" description="Observations and inferences remain uncertain until evidence is strong enough—and you can correct them at any time.">
        {recent.length === 0 ? <p className="text-sm text-tertiary">No emerging patterns yet. Atlas records meaningful outcomes, not every click.</p> : (
          <div className="grid gap-3 lg:grid-cols-2">{recent.slice(0, 12).map((item) => <Card key={item.id} as="article"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium text-primary">{item.title}</p><p className="mt-2 text-sm leading-relaxed text-secondary">{item.summary}</p></div><Confidence value={item.confidence} status={item.status} /></div><p className="mt-3 text-2xs text-tertiary">Why: {item.evidence_count} safe evidence signal{item.evidence_count === 1 ? '' : 's'} from {item.source_type.replace('_', ' ')}.</p><LearningReview id={item.id} /></Card>)}</div>
        )}
      </Section>

      <Section title="System health" description="Real aggregate timing and failure signals. No message bodies, audio, tokens or private payloads.">
        {metrics.length === 0 ? <p className="text-sm text-tertiary">The first daily reflection has not run yet.</p> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{metrics.slice(0, 12).map((metric) => <Card key={metric.id}><div className="flex items-center justify-between"><p className="text-sm font-medium text-primary">{metric.subsystem}</p><span className={metric.health_status === 'degraded' ? 'text-xs text-critical' : 'text-xs text-tertiary'}>{metric.health_status}</span></div><p className="mt-3 text-xl text-primary">{Number(metric.metric_value).toFixed(metric.unit === 'ratio' ? 2 : 0)} <span className="text-xs text-tertiary">{metric.unit}</span></p><p className="mt-1 text-2xs text-tertiary">{metric.metric_name.replace('_', ' ')} · {metric.sample_count} samples</p></Card>)}</div>}
      </Section>

      <Section title="Adaptations" description="Only low-risk, reversible behavior changes may activate automatically. Everything can be reverted.">
        {adaptations.length === 0 ? <p className="text-sm text-tertiary">No adaptations have been applied.</p> : <div className="space-y-3">{adaptations.map((item) => <Card key={item.id}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-medium text-primary">{item.title}</p><p className="mt-1 text-sm text-secondary">{item.description}</p><p className="mt-2 text-2xs text-tertiary">Reason: {item.reason} · {Math.round(item.confidence * 100)}% confidence · {item.risk_level} risk</p></div>{item.status === 'active' ? <AdaptationRevert id={item.id} /> : <span className="text-xs text-tertiary">{item.status}</span>}</div></Card>)}</div>}
      </Section>

      <Section title="Improvement opportunities" description="These are exportable proposals only. Atlas cannot execute code, run shell commands, push, merge or deploy them.">
        {proposals.length === 0 ? <p className="text-sm text-tertiary">No evidence-backed proposals yet.</p> : <div className="space-y-3">{proposals.map((proposal) => <Card key={proposal.id}><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 size-5 shrink-0 text-accent" /><div><p className="text-sm font-medium text-primary">{proposal.title}</p><p className="mt-2 text-sm text-secondary">{proposal.problem}</p><p className="mt-2 text-xs text-tertiary">Proposed: {proposal.proposed_solution}</p><p className="mt-1 text-xs text-tertiary">Benefit: {proposal.expected_benefit} · Risk: {proposal.risk_level}</p><div className="mt-4"><CopyProposal text={proposal.proposal_text} /></div></div></div></Card>)}</div>}
      </Section>

      <Section title="Data control" description="This only removes inferred learning, diagnostics, adaptations and proposals. Confirmed Memory is left intact."><Card><div className="flex items-center justify-between gap-4"><div className="flex items-center gap-3"><RotateCcw className="size-5 text-tertiary" /><div><p className="text-sm font-medium text-primary">Reset the evolution engine</p><p className="text-xs text-tertiary">Two clicks are required. This cannot delete tasks, Calendar data or confirmed memories.</p></div></div><ResetLearningButton /></div></Card></Section>
    </Page>
  );
}
