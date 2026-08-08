/** Pure, deterministic learning policy. No database or model calls live here. */

export type LearningStatus =
  | 'observed'
  | 'emerging'
  | 'suggested'
  | 'confirmed'
  | 'active'
  | 'retired'
  | 'superseded'
  | 'dismissed';

export type EvidenceStrength = 'weak' | 'normal' | 'strong' | 'explicit';

const STRENGTH_WEIGHT: Record<EvidenceStrength, number> = {
  weak: 0.025,
  normal: 0.06,
  strong: 0.11,
  explicit: 0.28,
};

export function canonicalLearningKey(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
}

export function reinforceConfidence(
  current: number,
  strength: EvidenceStrength = 'normal',
  independentEvidence = true,
): number {
  const weight = STRENGTH_WEIGHT[strength] * (independentEvidence ? 1 : 0.45);
  return clamp(current + (1 - current) * weight);
}

export function contradictConfidence(current: number, strength: EvidenceStrength = 'normal'): number {
  const penalty = STRENGTH_WEIGHT[strength] * (strength === 'explicit' ? 1.8 : 1.25);
  return clamp(current * (1 - penalty));
}

export function decayConfidence({
  confidence,
  daysSinceReinforced,
  pinned = false,
  userConfirmed = false,
  kind = 'inference',
}: {
  confidence: number;
  daysSinceReinforced: number;
  pinned?: boolean;
  userConfirmed?: boolean;
  kind?: string;
}): number {
  if (pinned || userConfirmed || kind === 'confirmed_memory') return clamp(confidence);
  const graceDays = kind === 'workflow' ? 30 : 21;
  const elapsed = Math.max(0, daysSinceReinforced - graceDays);
  // About a 180-day half-life after the grace period. Old weak inferences fade;
  // they are not abruptly deleted or presented as current truth.
  return clamp(confidence * Math.pow(0.5, elapsed / 180));
}

export function lifecycleFor({
  confidence,
  evidenceCount,
  userConfirmed = false,
  kind = 'inference',
}: {
  confidence: number;
  evidenceCount: number;
  userConfirmed?: boolean;
  kind?: string;
}): LearningStatus {
  if (userConfirmed) return kind === 'workflow' ? 'active' : 'confirmed';
  if (evidenceCount >= 5 && confidence >= 0.72) return 'suggested';
  if (evidenceCount >= 3 && confidence >= 0.52) return 'emerging';
  return 'observed';
}

export function proactivityScore({
  relevance,
  urgency,
  confidence,
  interruptionCost,
}: {
  relevance: number;
  urgency: number;
  confidence: number;
  interruptionCost: number;
}): number {
  return clamp(0.34 * relevance + 0.28 * urgency + 0.3 * confidence - 0.24 * interruptionCost);
}

export type Trend = 'improving' | 'stable' | 'degrading' | 'insufficient_data';

export function detectTrend(valuesNewestLast: number[], lowerIsBetter = true): Trend {
  if (valuesNewestLast.length < 4) return 'insufficient_data';
  const midpoint = Math.floor(valuesNewestLast.length / 2);
  const before = average(valuesNewestLast.slice(0, midpoint));
  const after = average(valuesNewestLast.slice(midpoint));
  if (before === 0 && after === 0) return 'stable';
  const delta = (after - before) / Math.max(Math.abs(before), 0.001);
  if (Math.abs(delta) < 0.12) return 'stable';
  const better = lowerIsBetter ? delta < 0 : delta > 0;
  return better ? 'improving' : 'degrading';
}

export function healthForMetric(metricName: string, value: number, sampleCount: number) {
  if (sampleCount < 3) return 'watch' as const;
  if (metricName === 'failure_rate') {
    if (value >= 0.2) return 'degraded' as const;
    if (value >= 0.08) return 'watch' as const;
  }
  if (metricName === 'latency_ms') {
    if (value >= 8_000) return 'degraded' as const;
    if (value >= 3_000) return 'watch' as const;
  }
  return 'healthy' as const;
}

const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\b(?:password|passcode|otp|one[- ]time code|recovery phrase|seed phrase)\s*[:=]/i,
  /\b(?:sk|AIza)[-_a-z0-9]{20,}\b/i,
  /\b(?:\d[ -]*?){13,19}\b/,
];

export function isUnsafeLearningContent(value: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(value));
}

export function boundedEvidence<T>(existing: T[], next: T, max = 12): T[] {
  return [...existing, next].slice(-Math.max(1, max));
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function clamp(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}
