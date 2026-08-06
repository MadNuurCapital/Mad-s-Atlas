import { describe, expect, it } from 'vitest';

import { extractSources } from '@/lib/atlas/research/provider';

/**
 * The property under test: a citation is only ever something grounding
 * actually returned. An invented URL is worse than no citation, because it
 * looks like evidence.
 */
describe('source extraction', () => {
  it('keeps real grounded sources', () => {
    const sources = extractSources([
      { web: { uri: 'https://www.straitstimes.com/business/x', title: 'Markets rise', domain: 'straitstimes.com' } },
    ]);

    expect(sources).toHaveLength(1);
    expect(sources[0]?.url).toContain('straitstimes.com');
    expect(sources[0]?.title).toBe('Markets rise');
  });

  it('NEVER invents a publication date', () => {
    // Grounding does not reliably supply one. Guessing would fabricate a fact
    // about someone else's article.
    const sources = extractSources([{ web: { uri: 'https://example.com/a', title: 'A' } }]);
    expect(sources[0]?.publicationDate).toBeNull();
  });

  it('drops sources whose URL points inside a private network', () => {
    const sources = extractSources([
      { web: { uri: 'http://169.254.169.254/latest/meta-data/', title: 'Metadata' } },
      { web: { uri: 'http://localhost:3000/', title: 'Local' } },
      { web: { uri: 'https://example.com/real', title: 'Real' } },
    ]);

    expect(sources).toHaveLength(1);
    expect(sources[0]?.title).toBe('Real');
  });

  it('drops non-http schemes', () => {
    expect(extractSources([{ web: { uri: 'javascript:alert(1)', title: 'x' } }])).toEqual([]);
  });

  it('collapses duplicates by URL', () => {
    const sources = extractSources([
      { web: { uri: 'https://example.com/a', title: 'First' } },
      { web: { uri: 'https://example.com/a', title: 'Duplicate' } },
    ]);
    expect(sources).toHaveLength(1);
  });

  it('returns nothing when grounding returned nothing', () => {
    // The caller marks the report unverified rather than filling the gap.
    expect(extractSources(undefined)).toEqual([]);
    expect(extractSources([])).toEqual([]);
    expect(extractSources([{ web: {} }])).toEqual([]);
  });

  it('falls back to the hostname when a title is missing', () => {
    const sources = extractSources([{ web: { uri: 'https://www.bbc.co.uk/news' } }]);
    expect(sources[0]?.title).toBe('www.bbc.co.uk');
    expect(sources[0]?.publisher).toBe('bbc.co.uk');
  });
});
