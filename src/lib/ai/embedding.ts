import 'server-only';

import { serverEnv } from '@/lib/validation/env';

/**
 * Embedding provider abstraction.
 *
 * Isolated behind an interface so changing model or provider is one file plus
 * a documented re-embedding migration — see MEMORY_SYSTEM.md § Changing
 * embedding dimensions.
 */

/**
 * 1536, not the model's default 3072.
 *
 * pgvector cannot build an HNSW or IVFFlat index on a vector wider than 2000
 * dimensions, so a 3072-dimension column means a sequential scan on every
 * semantic search. Matryoshka Representation Learning lets the model emit 1536
 * with minimal quality loss, keeping both the accuracy and the index.
 *
 * This constant and the `extensions.vector(1536)` column type must agree.
 */
export const EMBEDDING_DIMENSIONS = 1536;

export interface EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

export class EmbeddingError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'EmbeddingError';
    this.code = code;
  }
}

/** Format a vector for pgvector, which accepts a bracketed list as text. */
export function toVectorLiteral(embedding: number[]): string {
  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new EmbeddingError(
      'dimension_mismatch',
      `Expected ${EMBEDDING_DIMENSIONS} dimensions, received ${embedding.length}. ` +
        'Storing a mismatched vector would make every semantic search wrong.',
    );
  }
  return `[${embedding.join(',')}]`;
}

/**
 * Gemini embeddings.
 *
 * NOTE: not exercised against the real API in this codebase yet — that needs a
 * GEMINI_API_KEY. The request shape follows the documented REST contract and
 * the error paths are unit-tested with a stubbed fetch. See README § What has
 * actually been verified.
 */
class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  readonly dimensions = EMBEDDING_DIMENSIONS;

  private readonly apiKey: string;

  constructor(model: string, apiKey: string) {
    this.model = model;
    this.apiKey = apiKey;
  }

  async embed(text: string): Promise<number[]> {
    const [first] = await this.embedBatch([text]);
    if (!first) throw new EmbeddingError('empty_response', 'The provider returned no embedding.');
    return first;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:batchEmbedContents`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // Header, not query string: a key in a URL ends up in logs.
            'x-goog-api-key': this.apiKey,
          },
          body: JSON.stringify({
            requests: texts.map((text) => ({
              model: `models/${this.model}`,
              content: { parts: [{ text }] },
              taskType: 'RETRIEVAL_DOCUMENT',
              outputDimensionality: this.dimensions,
            })),
          }),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        // The body can echo the request; never surface it.
        throw new EmbeddingError(
          'provider_error',
          `Embedding request failed with status ${response.status}.`,
        );
      }

      const body = (await response.json()) as {
        embeddings?: Array<{ values?: number[] }>;
      };

      const embeddings = body.embeddings ?? [];
      if (embeddings.length !== texts.length) {
        throw new EmbeddingError(
          'count_mismatch',
          `Requested ${texts.length} embeddings but received ${embeddings.length}.`,
        );
      }

      return embeddings.map((item, index) => {
        const values = item.values ?? [];
        if (values.length !== this.dimensions) {
          throw new EmbeddingError(
            'dimension_mismatch',
            `Embedding ${index} has ${values.length} dimensions, expected ${this.dimensions}.`,
          );
        }
        return values;
      });
    } catch (error) {
      if (error instanceof EmbeddingError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new EmbeddingError('timeout', 'The embedding request timed out.');
      }
      throw new EmbeddingError('network_error', 'Could not reach the embedding provider.');
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createEmbeddingProvider(): EmbeddingProvider {
  const env = serverEnv();
  return new GeminiEmbeddingProvider(env.GEMINI_EMBEDDING_MODEL, env.GEMINI_API_KEY);
}
