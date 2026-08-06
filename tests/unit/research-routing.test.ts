import { describe, expect, it } from 'vitest';

import { requiresLiveResearch } from '@/lib/atlas/research/routing';
import { displayHost, isSafeExternalUrl, validateExternalUrl } from '@/lib/validation/url';

describe('current-information routing', () => {
  const mustResearch = [
    'What happened in the news today?',
    'What is the current CPF contribution rate?',
    'How are the markets doing?',
    "What's the latest Gemini model?",
    'What is the weather forecast for tomorrow?',
    'Has the interest rate changed recently?',
    'What did the prime minister announce this week?',
    'What is the exchange rate right now?',
    'Any recent AI model releases?',
    'What changed in Singapore tax policy in 2026?',
  ];

  it.each(mustResearch)('routes to live research: %s', (question) => {
    // Answering any of these from training data yields a confident, plausible,
    // possibly-stale answer — worse than none, because it looks trustworthy.
    expect(requiresLiveResearch(question).requiresLiveResearch).toBe(true);
  });

  const timeless = [
    'Remind me to call the dentist',
    'What tasks are overdue?',
    'Summarise my calendar',
    'Add milk to my list',
    'How do I spell accommodation?',
  ];

  it.each(timeless)('does not force research for: %s', (question) => {
    expect(requiresLiveResearch(question).requiresLiveResearch).toBe(false);
  });

  it('reports which signals fired, for the audit trail', () => {
    const decision = requiresLiveResearch('What is the latest news on inflation?');
    expect(decision.matchedSignals).toContain('latest');
    expect(decision.matchedSignals).toContain('inflation');
  });
});

describe('source URL validation', () => {
  it('accepts ordinary public sources', () => {
    expect(isSafeExternalUrl('https://www.straitstimes.com/business/article')).toBe(true);
    expect(isSafeExternalUrl('http://example.com/path?q=1')).toBe(true);
  });

  const hostile: Array<[label: string, url: string]> = [
    ['loopback by name', 'http://localhost:3000/admin'],
    ['loopback by address', 'http://127.0.0.1/'],
    ['all-zeros', 'http://0.0.0.0/'],
    ['private 10.x', 'http://10.0.0.5/'],
    ['private 172.16.x', 'http://172.16.0.1/'],
    ['private 192.168.x', 'http://192.168.1.1/'],
    ['carrier-grade NAT', 'http://100.64.0.1/'],
    ['cloud metadata by address', 'http://169.254.169.254/latest/meta-data/'],
    ['cloud metadata by name', 'http://metadata.google.internal/'],
    ['IPv6 loopback', 'http://[::1]/'],
    ['IPv6 unique-local', 'http://[fd00::1]/'],
    ['IPv4-mapped IPv6', 'http://[::ffff:127.0.0.1]/'],
    ['internal suffix', 'http://db.internal/'],
    ['mDNS suffix', 'http://printer.local/'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['data scheme', 'data:text/html,<script>alert(1)</script>'],
    ['file scheme', 'file:///etc/passwd'],
    ['embedded credentials', 'https://user:pass@example.com/'],
  ];

  it.each(hostile)('rejects %s', (_label, url) => {
    expect(isSafeExternalUrl(url)).toBe(false);
  });

  it('rejects a malformed address rather than guessing', () => {
    expect(isSafeExternalUrl('not a url')).toBe(false);
    expect(validateExternalUrl('http://999.999.999.999/').valid).toBe(false);
  });

  it('shows the host so a reader can see where a link leads', () => {
    expect(displayHost('https://www.bbc.co.uk/news/article')).toBe('bbc.co.uk');
    expect(displayHost('not a url')).toBe('unknown source');
  });
});
