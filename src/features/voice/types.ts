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
  idle: 'Not connected',
  requesting_permission: 'Waiting for microphone permission',
  connecting: 'Connecting',
  listening: 'Listening',
  understanding: 'Thinking',
  using_tool: 'Using a tool',
  speaking: 'Speaking',
  reconnecting: 'Reconnecting',
  error: 'Something went wrong',
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
  };
};
