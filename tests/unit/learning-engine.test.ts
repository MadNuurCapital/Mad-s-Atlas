import { describe, expect, it } from 'vitest';

import {
  boundedEvidence,
  canonicalLearningKey,
  contradictConfidence,
  decayConfidence,
  detectTrend,
  healthForMetric,
  isUnsafeLearningContent,
  lifecycleFor,
  proactivityScore,
  reinforceConfidence,
} from '@/lib/atlas/learning/engine';

describe('learning confidence and lifecycle', () => {
  it('reinforces repeated independent evidence with diminishing returns', () => {
    const first = reinforceConfidence(0.3, 'normal');
    const second = reinforceConfidence(first, 'normal');
    expect(first).toBeGreaterThan(0.3);
    expect(second).toBeGreaterThan(first);
    expect(second - first).toBeLessThan(first - 0.3);
  });

  it('weights explicit evidence more strongly and bounds confidence', () => {
    expect(reinforceConfidence(0.8, 'explicit')).toBeGreaterThan(reinforceConfidence(0.8, 'weak'));
    expect(reinforceConfidence(1, 'explicit')).toBe(1);
    expect(contradictConfidence(0, 'explicit')).toBe(0);
  });

  it('keeps observations uncertain until both evidence and confidence qualify', () => {
    expect(lifecycleFor({ confidence: 0.9, evidenceCount: 1 })).toBe('observed');
    expect(lifecycleFor({ confidence: 0.55, evidenceCount: 3 })).toBe('emerging');
    expect(lifecycleFor({ confidence: 0.75, evidenceCount: 5 })).toBe('suggested');
    expect(lifecycleFor({ confidence: 0.2, evidenceCount: 1, userConfirmed: true })).toBe('confirmed');
    expect(lifecycleFor({ confidence: 0.2, evidenceCount: 1, userConfirmed: true, kind: 'workflow' })).toBe('active');
  });

  it('decays stale inferences but never confirmed or pinned knowledge', () => {
    expect(decayConfidence({ confidence: 0.8, daysSinceReinforced: 200 })).toBeLessThan(0.8);
    expect(decayConfidence({ confidence: 0.8, daysSinceReinforced: 200, pinned: true })).toBe(0.8);
    expect(decayConfidence({ confidence: 0.8, daysSinceReinforced: 200, userConfirmed: true })).toBe(0.8);
  });
});

describe('learning safety and deterministic diagnosis', () => {
  it('normalises equivalent keys for deduplication', () => {
    expect(canonicalLearningKey('  Research: AI Markets  ')).toBe('research-ai-markets');
  });

  it('rejects common secret and financial patterns', () => {
    expect(isUnsafeLearningContent('password: correct horse battery staple')).toBe(true);
    expect(isUnsafeLearningContent('4111 1111 1111 1111')).toBe(true);
    expect(isUnsafeLearningContent('Prefers short spoken answers')).toBe(false);
  });

  it('keeps only bounded recent evidence', () => {
    expect(boundedEvidence([1, 2, 3], 4, 3)).toEqual([2, 3, 4]);
  });

  it('scores low-confidence, high-interruption suggestions conservatively', () => {
    const quiet = proactivityScore({ relevance: 0.6, urgency: 0.2, confidence: 0.4, interruptionCost: 0.9 });
    const useful = proactivityScore({ relevance: 0.95, urgency: 0.9, confidence: 0.9, interruptionCost: 0.1 });
    expect(quiet).toBeLessThan(0.25);
    expect(useful).toBeGreaterThan(0.75);
  });

  it('requires enough metric history before claiming a trend', () => {
    expect(detectTrend([10, 11, 12])).toBe('insufficient_data');
    expect(detectTrend([100, 100, 60, 55], true)).toBe('improving');
    expect(detectTrend([50, 55, 100, 110], true)).toBe('degrading');
    expect(detectTrend([100, 102, 99, 101], true)).toBe('stable');
  });

  it('uses explicit health thresholds and marks tiny samples for watching', () => {
    expect(healthForMetric('failure_rate', 0.5, 2)).toBe('watch');
    expect(healthForMetric('failure_rate', 0.21, 10)).toBe('degraded');
    expect(healthForMetric('latency_ms', 500, 10)).toBe('healthy');
  });
});
