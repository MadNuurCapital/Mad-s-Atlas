/**
 * Current-information routing.
 *
 * A question about anything that may have changed must go to live research,
 * never to the model's built-in knowledge. Answering "what's the CPF rate?"
 * from training data produces a confident, plausible, possibly-stale answer —
 * which is worse than saying nothing, because it looks trustworthy.
 */

/** Words that signal the answer depends on a moment in time. */
const TEMPORAL_MARKERS = [
  'today', "today's", 'tonight', 'now', 'currently', 'current',
  'recent', 'recently', 'latest', 'newest', 'this week', 'this month',
  'this year', 'yesterday', 'tomorrow', 'right now', 'at the moment',
  'up to date', 'so far', 'just announced', 'breaking',
];

/** Subjects whose facts change even without a temporal word attached. */
const VOLATILE_SUBJECTS = [
  'news', 'headline', 'market', 'markets', 'stock', 'share price', 'index',
  'exchange rate', 'interest rate', 'inflation', 'gdp', 'economy',
  'price', 'cost of', 'weather', 'forecast', 'temperature',
  'law', 'legislation', 'regulation', 'policy', 'tax rate', 'cpf',
  'president', 'prime minister', 'minister', 'election', 'government',
  'released', 'launch', 'launched', 'announcement', 'announced',
  'version', 'release notes', 'roadmap',
  'ai model', 'llm', 'gpt', 'gemini', 'claude', 'openai', 'anthropic',
  'score', 'result', 'fixture', 'schedule',
];

export type ResearchRoutingDecision = {
  /** True when the question must not be answered from model knowledge. */
  requiresLiveResearch: boolean;
  /** Which signals fired, for the audit trail and for explaining the choice. */
  matchedSignals: string[];
};

/**
 * Decide whether a question needs live research.
 *
 * Deliberately biased toward researching. A needless search costs a fraction
 * of a cent; a confidently stale answer costs trust, and Muhammad may act on
 * it before noticing.
 */
export function requiresLiveResearch(question: string): ResearchRoutingDecision {
  const text = question.toLowerCase();
  const matched: string[] = [];

  for (const marker of TEMPORAL_MARKERS) {
    if (text.includes(marker)) matched.push(marker);
  }

  for (const subject of VOLATILE_SUBJECTS) {
    if (text.includes(subject)) matched.push(subject);
  }

  // "in 2026", "since 2025" — a year reference usually means "as things stand".
  if (/\b(19|20)\d{2}\b/.test(text)) matched.push('explicit year');

  return { requiresLiveResearch: matched.length > 0, matchedSignals: [...new Set(matched)] };
}
