/**
 * Voice session states.
 *
 * Exactly one is shown at a time. `listening` means the microphone is
 * genuinely live and capturing — the interface never claims to be listening
 * when it is not, which is a privacy commitment rather than a UI detail.
 */
export type VoiceState =
  | 'idle'
  | 'requesting_permission'
  | 'connecting'
  | 'listening'
  | 'understanding'
  | 'using_tool'
  | 'speaking'
  | 'reconnecting'
  | 'error';

export const VOICE_STATE_LABEL: Record<VoiceState, string> = {
  idle: 'Atlas // Standby',
  requesting_permission: 'Atlas // Permission',
  connecting: 'Atlas // Connecting',
  listening: 'Atlas // Listening',
  understanding: 'Atlas // Processing',
  using_tool: 'Atlas // Executing',
  speaking: 'Atlas // Responding',
  reconnecting: 'Atlas // Reconnecting',
  error: 'Atlas // Error',
};

export type TranscriptEntry = {
  id: string;
  speaker: 'you' | 'atlas';
  text: string;
  /** Streaming entries are still being appended to. */
  final: boolean;
};

export type LiveTokenResponse = {
  token: string;
  sessionConfig: {
    model: string;
    responseModalities: string[];
    expiresAt: string;
    newSessionExpiresAt: string;
    preferredName?: string;
    adaptiveInstructions?: string[];
    voice: string;
  };
};
