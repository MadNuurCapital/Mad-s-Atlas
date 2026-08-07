import 'server-only';

import { GoogleGenAI, Modality } from '@google/genai';

import { serverEnv } from '@/lib/validation/env';

/**
 * Ephemeral token minting for Gemini Live.
 *
 * This is the only reason the browser can talk to Gemini directly without ever
 * holding GEMINI_API_KEY. The token is the security control, which is why the
 * browser connects straight to the Live WebSocket — proxying audio through
 * Netlify would add latency without adding safety.
 *
 * The parameter shapes here were read from the installed @google/genai types
 * rather than from documentation, because the surface has moved between SDK
 * versions.
 */

export type LiveTokenResult = {
  /** The ephemeral token. Never logged. */
  token: string;
  /** Safe session configuration the browser needs to connect. */
  sessionConfig: {
    model: string;
    responseModalities: string[];
    expiresAt: string;
    newSessionExpiresAt: string;
  };
};

export class LiveTokenError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'LiveTokenError';
    this.code = code;
  }
}

/**
 * How long a minted token stays usable.
 *
 * `newSessionExpire` is short on purpose: the token must be minted immediately
 * before connecting, not at page load. A minute is ample for a click-to-connect
 * and keeps a leaked token nearly worthless.
 *
 * `sessionExpire` bounds the whole conversation, which is also the cost
 * control — see PERMISSIONS.md § Budget guardrails.
 */
const NEW_SESSION_WINDOW_MS = 60_000;
const MAX_SESSION_MS = 30 * 60_000;

export async function createLiveToken(): Promise<LiveTokenResult> {
  const env = serverEnv();
  const model = env.GEMINI_LIVE_MODEL;

  const now = Date.now();
  const newSessionExpireTime = new Date(now + NEW_SESSION_WINDOW_MS).toISOString();
  const expireTime = new Date(now + MAX_SESSION_MS).toISOString();

  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

  try {
    const token = await ai.authTokens.create({
      config: {
        // Single use. Resuming a session does not consume another use, so
        // session resumption still works after a dropped connection.
        uses: 1,
        expireTime,
        newSessionExpireTime,
        liveConnectConstraints: {
          // Locked to the configured model: a leaked token cannot be pointed
          // at a different, more expensive one.
          model,
          config: {
            responseModalities: [Modality.AUDIO],
            sessionResumption: {},
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          },
        },
        // Lock the fields the browser could otherwise override.
        lockAdditionalFields: [],
        // Ephemeral token provisioning is currently served through v1alpha;
        // the token itself connects to the constrained v1beta Live endpoint.
        httpOptions: { apiVersion: 'v1alpha' },
      },
    });

    if (!token.name) {
      throw new LiveTokenError('no_token_returned', 'Gemini returned no ephemeral token.');
    }

    return {
      token: token.name,
      sessionConfig: {
        model,
        responseModalities: ['AUDIO'],
        expiresAt: expireTime,
        newSessionExpiresAt: newSessionExpireTime,
      },
    };
  } catch (error) {
    if (error instanceof LiveTokenError) throw error;

    // The provider message can echo the request; never surface or store it.
    throw new LiveTokenError(
      'mint_failed',
      'Could not start a voice session. Please try again in a moment.',
    );
  }
}
