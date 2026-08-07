import type { LiveTokenResponse } from '@/features/voice/types';

/**
 * Raw Gemini Live protocol helpers.
 *
 * Keeping message construction and PCM conversion here makes the security-
 * sensitive WebSocket boundary testable without a browser or a real token.
 */

export const GEMINI_LIVE_WEBSOCKET_ENDPOINT =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained';

export const GEMINI_INPUT_SAMPLE_RATE = 16_000;
export const GEMINI_OUTPUT_SAMPLE_RATE = 24_000;

export function canResumeLiveSession(options: {
  attempts: number;
  expiresAt: string;
  maxAttempts: number;
  now?: number;
  resumeHandle: string | null;
}): boolean {
  return (
    Boolean(options.resumeHandle) &&
    options.attempts < options.maxAttempts &&
    new Date(options.expiresAt).getTime() > (options.now ?? Date.now())
  );
}

export type GeminiLiveServerMessage = {
  setupComplete?: Record<string, never>;
  sessionResumptionUpdate?: {
    newHandle?: string;
    resumable?: boolean;
  };
  serverContent?: {
    inputTranscription?: { text?: string };
    interrupted?: boolean;
    modelTurn?: {
      parts?: Array<{
        inlineData?: {
          data?: string;
          mimeType?: string;
        };
      }>;
    };
    outputTranscription?: { text?: string };
    turnComplete?: boolean;
  };
};

export function createLiveWebSocketUrl(token: string): string {
  const url = new URL(GEMINI_LIVE_WEBSOCKET_ENDPOINT);
  url.searchParams.set('access_token', token);
  return url.toString();
}

export function createLiveSetupMessage(
  sessionConfig: LiveTokenResponse['sessionConfig'],
  resumeHandle: string | null,
) {
  return {
    setup: {
      model: `models/${sessionConfig.model.replace(/^models\//, '')}`,
      generationConfig: {
        responseModalities: sessionConfig.responseModalities,
      },
      sessionResumption: resumeHandle ? { handle: resumeHandle } : {},
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
  };
}

/** Downsample mono float audio before converting it to Gemini's 16 kHz PCM. */
export function downsampleAudio(
  input: Float32Array,
  inputSampleRate: number,
  outputSampleRate = GEMINI_INPUT_SAMPLE_RATE,
): Float32Array {
  if (outputSampleRate > inputSampleRate) {
    throw new Error('Output sample rate must not exceed the input sample rate.');
  }
  if (outputSampleRate === inputSampleRate) return new Float32Array(input);

  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);

  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const start = Math.round(outputIndex * ratio);
    const end = Math.min(input.length, Math.round((outputIndex + 1) * ratio));
    let total = 0;
    let samples = 0;

    for (let inputIndex = start; inputIndex < end; inputIndex += 1) {
      total += input[inputIndex] ?? 0;
      samples += 1;
    }

    output[outputIndex] = samples > 0 ? total / samples : 0;
  }

  return output;
}

export function floatAudioToPcm16(input: Float32Array): Uint8Array {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);

  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index] ?? 0));
    const pcm = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    view.setInt16(index * 2, Math.round(pcm), true);
  }

  return new Uint8Array(buffer);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return btoa(binary);
}

export function base64Pcm16ToFloatAudio(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const output = new Float32Array(Math.floor(bytes.byteLength / 2));

  for (let index = 0; index < output.length; index += 1) {
    const value = view.getInt16(index * 2, true);
    output[index] = value < 0 ? value / 0x8000 : value / 0x7fff;
  }

  return output;
}

export function sampleRateFromMimeType(
  mimeType: string | undefined,
  fallback = GEMINI_OUTPUT_SAMPLE_RATE,
): number {
  const match = mimeType?.match(/(?:^|;)\s*rate=(\d+)/i);
  const parsed = match?.[1] ? Number.parseInt(match[1], 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function createRealtimeAudioMessage(base64Pcm: string) {
  return {
    realtimeInput: {
      audio: {
        data: base64Pcm,
        mimeType: `audio/pcm;rate=${GEMINI_INPUT_SAMPLE_RATE}`,
      },
    },
  };
}

export async function parseLiveServerMessage(data: unknown): Promise<GeminiLiveServerMessage | null> {
  let text: string;

  if (typeof data === 'string') {
    text = data;
  } else if (data instanceof Blob) {
    text = await data.text();
  } else if (data instanceof ArrayBuffer) {
    text = new TextDecoder().decode(data);
  } else if (ArrayBuffer.isView(data)) {
    text = new TextDecoder().decode(data);
  } else {
    return null;
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as GeminiLiveServerMessage) : null;
  } catch {
    return null;
  }
}
