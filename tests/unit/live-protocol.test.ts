import { describe, expect, it } from 'vitest';

import {
  base64Pcm16ToFloatAudio,
  bytesToBase64,
  canResumeLiveSession,
  createLiveSetupMessage,
  createLiveWebSocketUrl,
  createRealtimeAudioMessage,
  createToolResponseMessage,
  downsampleAudio,
  floatAudioToPcm16,
  GEMINI_LIVE_WEBSOCKET_ENDPOINT,
  normaliseAtlasAddress,
  parseLiveServerMessage,
  sampleRateFromMimeType,
} from '@/features/voice/live-protocol';

describe('Gemini Live protocol', () => {
  it('uses the constrained endpoint required by ephemeral tokens', () => {
    expect(GEMINI_LIVE_WEBSOCKET_ENDPOINT).toContain('BidiGenerateContentConstrained');
    expect(GEMINI_LIVE_WEBSOCKET_ENDPOINT).toContain('.v1alpha.');
    expect(GEMINI_LIVE_WEBSOCKET_ENDPOINT).not.toMatch(/BidiGenerateContent$/);

    const url = new URL(createLiveWebSocketUrl('auth_tokens/example'));
    expect(url.searchParams.get('access_token')).toBe('auth_tokens/example');
  });

  it('builds a model-locked audio setup message with transcription and resumption', () => {
    const message = createLiveSetupMessage(
        {
          model: 'models/gemini-3.1-flash-live-preview',
          responseModalities: ['AUDIO'],
          expiresAt: '2026-08-07T11:00:00.000Z',
          newSessionExpiresAt: '2026-08-07T10:31:00.000Z',
          voice: 'Charon',
        },
        'resume-handle',
      );

    expect(message).toMatchObject({
      setup: {
        model: 'models/gemini-3.1-flash-live-preview',
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } },
          },
        },
        sessionResumption: { handle: 'resume-handle' },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
    });
    expect(message.setup.systemInstruction.parts[0]?.text).toContain('Never claim an action succeeded');
    expect(message.setup.tools[0]?.functionDeclarations.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        'tasks.list',
        'tasks.create',
        'reminders.list',
        'reminders.create',
        'ideas.list',
        'ideas.capture',
        'ideas.get',
        'ideas.propose_plan',
        'ideas.approve_plan',
        'ideas.add_note',
        'ideas.complete_step',
        'ideas.archive',
        'ideas.restore',
        'ideas.propose_delete',
        'calendar.list_today',
        'calendar.list_range',
        'calendar.execute_create',
        'memory.search',
        'memory.remember',
        'research.current_web',
        'gmail.search',
      ]),
    );
    expect(message.setup.systemInstruction.parts[0]?.text).toContain(
      'Calendar events are created immediately',
    );
    expect(message.setup.systemInstruction.parts[0]?.text).toContain('memory.search');
    expect(message.setup.systemInstruction.parts[0]?.text).toContain('ideas.capture');
    expect(message.setup.systemInstruction.parts[0]?.text).toContain('Only call ideas.approve_plan after');
    expect(message.setup.systemInstruction.parts[0]?.text).toContain('do not copy them to global Memory');
  });

  it('normalises only likely direct-address mishearings of Atlas', () => {
    expect(normaliseAtlasAddress('Alice, add this to my plan')).toBe('Atlas, add this to my plan');
    expect(normaliseAtlasAddress('Ellis can you show my tasks?')).toBe('Atlas can you show my tasks?');
    expect(normaliseAtlasAddress('At last, what is next?')).toBe('Atlas, what is next?');
    expect(normaliseAtlasAddress('I spoke to Alice yesterday')).toBe('I spoke to Alice yesterday');
    expect(normaliseAtlasAddress('Alice went to the office')).toBe('Alice went to the office');
  });

  it('matches Gemini tool responses to their original function calls', () => {
    expect(
      createToolResponseMessage([
        { id: 'call-1', name: 'tasks.list', response: { output: { ok: true } } },
      ]),
    ).toEqual({
      toolResponse: {
        functionResponses: [
          { id: 'call-1', name: 'tasks.list', response: { output: { ok: true } } },
        ],
      },
    });
  });

  it('downsamples and encodes little-endian signed 16-bit PCM', () => {
    const downsampled = downsampleAudio(new Float32Array([1, 1, 0, 0, -1, -1]), 48_000, 16_000);
    expect(downsampled[0]).toBeCloseTo(2 / 3);
    expect(downsampled[1]).toBeCloseTo(-2 / 3);

    expect([...floatAudioToPcm16(new Float32Array([-1, 0, 1]))]).toEqual([
      0x00, 0x80, 0x00, 0x00, 0xff, 0x7f,
    ]);
  });

  it('round-trips PCM audio and declares the required input MIME type', () => {
    const source = new Float32Array([-0.5, 0, 0.5]);
    const base64 = bytesToBase64(floatAudioToPcm16(source));
    const decoded = base64Pcm16ToFloatAudio(base64);

    expect([...decoded]).toEqual([
      expect.closeTo(-0.5, 3),
      0,
      expect.closeTo(0.5, 3),
    ]);
    expect(createRealtimeAudioMessage(base64)).toEqual({
      realtimeInput: {
        audio: { data: base64, mimeType: 'audio/pcm;rate=16000' },
      },
    });
  });

  it('parses text and binary server messages and ignores malformed input', async () => {
    expect(sampleRateFromMimeType('audio/pcm;rate=24000')).toBe(24_000);
    expect(sampleRateFromMimeType(undefined)).toBe(24_000);
    expect(await parseLiveServerMessage('{"setupComplete":{}}')).toEqual({ setupComplete: {} });
    expect(await parseLiveServerMessage(new Blob(['{"setupComplete":{}}']))).toEqual({
      setupComplete: {},
    });
    expect(
      await parseLiveServerMessage(new TextEncoder().encode('{"setupComplete":{}}').buffer),
    ).toEqual({ setupComplete: {} });
    expect(await parseLiveServerMessage('not json')).toBeNull();
    expect(await parseLiveServerMessage({})).toBeNull();
  });

  it('resumes only an established, unexpired session and caps retries', () => {
    const base = {
      attempts: 0,
      expiresAt: '2026-08-07T11:00:00.000Z',
      maxAttempts: 2,
      now: Date.parse('2026-08-07T10:30:00.000Z'),
      resumeHandle: 'server-issued-handle',
    };

    expect(canResumeLiveSession(base)).toBe(true);
    expect(canResumeLiveSession({ ...base, resumeHandle: null })).toBe(false);
    expect(canResumeLiveSession({ ...base, attempts: 2 })).toBe(false);
    expect(
      canResumeLiveSession({ ...base, now: Date.parse('2026-08-07T11:00:00.000Z') }),
    ).toBe(false);
  });
});
