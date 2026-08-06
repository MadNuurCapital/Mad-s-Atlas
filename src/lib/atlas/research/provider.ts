import 'server-only';

import { GoogleGenAI } from '@google/genai';

import { validateExternalUrl } from '@/lib/validation/url';
import { serverEnv } from '@/lib/validation/env';

/**
 * Grounded research.
 *
 * The rule this module exists to enforce: **citations come from grounding
 * metadata, never from generated text.** A model asked to "include sources"
 * will happily invent a plausible URL, and an invented citation is worse than
 * none — it looks like evidence.
 *
 * So sources are read from `groundingMetadata.groundingChunks` only. If the
 * provider returns no grounding, the report says so and is not presented as
 * verified.
 *
 * NOT exercised against the live API — that needs a GEMINI_API_KEY. Extraction,
 * URL validation and the no-sources path are unit-tested against stubbed
 * responses.
 */

export type ResearchSource = {
  title: string;
  publisher: string | null;
  url: string;
  publicationDate: string | null;
};

export type ResearchOutcome = {
  query: string;
  searchedAt: string;
  summary: string;
  sources: ResearchSource[];
  /** True when grounding returned nothing usable. */
  unverified: boolean;
  /** Stated plainly when the answer could not be grounded. */
  caveat: string | null;
};

type GroundingChunk = {
  web?: { uri?: string; title?: string; domain?: string };
};

/**
 * Pull sources out of grounding metadata.
 *
 * Every URL is validated: a source is stored and displayed, so a hostile
 * address must not reach either. Duplicates collapse by URL.
 */
export function extractSources(chunks: GroundingChunk[] | undefined): ResearchSource[] {
  const seen = new Set<string>();
  const sources: ResearchSource[] = [];

  for (const chunk of chunks ?? []) {
    const uri = chunk.web?.uri;
    if (!uri) continue;

    const validation = validateExternalUrl(uri);
    if (!validation.valid) continue;

    const url = validation.url.toString();
    if (seen.has(url)) continue;
    seen.add(url);

    sources.push({
      title: chunk.web?.title?.trim() || validation.url.hostname,
      publisher: chunk.web?.domain?.trim() ?? validation.url.hostname.replace(/^www\./, ''),
      url,
      // NEVER inferred. An absent date stays absent — a guessed publication
      // date is a fabricated fact about someone else's article.
      publicationDate: null,
    });
  }

  return sources;
}

export async function researchCurrentWeb(query: string): Promise<ResearchOutcome> {
  const env = serverEnv();
  const searchedAt = new Date().toISOString();

  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

  const response = await ai.models.generateContent({
    model: env.GEMINI_TEXT_MODEL,
    contents: query,
    config: {
      tools: [{ googleSearch: {} }],
      systemInstruction:
        'You are researching current information. Report only what the search results support. ' +
        'State uncertainty plainly. If sources conflict, say so and describe both. ' +
        'Never invent a citation, a statistic or a date.',
    },
  });

  const candidate = response.candidates?.[0];
  const sources = extractSources(
    candidate?.groundingMetadata?.groundingChunks as GroundingChunk[] | undefined,
  );

  const summary = response.text?.trim() ?? '';

  return {
    query,
    searchedAt,
    summary,
    sources,
    unverified: sources.length === 0,
    caveat:
      sources.length === 0
        ? 'This could not be grounded in live sources, so treat it as unverified.'
        : null,
  };
}
