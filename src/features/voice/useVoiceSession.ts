'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

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
  normaliseAtlasAddress,
  type GeminiFunctionResponse,
  parseLiveServerMessage,
  sampleRateFromMimeType,
} from '@/features/voice/live-protocol';
import type { LiveTokenResponse, TranscriptEntry, VoiceState } from '@/features/voice/types';

type AudioPipeline = {
  context: AudioContext;
  input: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  silentOutput: GainNode;
};

const MAX_RESUME_ATTEMPTS = 2;
const RESUME_BASE_DELAY_MS = 750;
const SETUP_TIMEOUT_MS = 12_000;

/**
 * Voice session lifecycle.
 *
 * One explicit click creates one short-lived token. If an established session
 * drops, Atlas can resume it twice with the SAME token and server-issued
 * handle; it never mints tokens in an automatic retry loop.
 */
export function useVoiceSession() {
  const [state, setState] = useState<VoiceState>('idle');
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [outputLevel, setOutputLevel] = useState(0);
  const [focusMode, setFocusModeState] = useState(false);
  const [holdingToTalk, setHoldingToTalkState] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const credentialsRef = useRef<LiveTokenResponse | null>(null);
  const resumeHandleRef = useRef<string | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalStopRef = useRef(false);
  const startInFlightRef = useRef(false);
  const sessionReadyRef = useRef(false);
  const toolResponsesRef = useRef(new Map<string, GeminiFunctionResponse>());
  const focusModeRef = useRef(false);
  const holdingToTalkRef = useRef(false);

  const audioPipelineRef = useRef<AudioPipeline | null>(null);
  const playbackSourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const nextPlaybackTimeRef = useRef(0);
  const connectRef = useRef<(credentials: LiveTokenResponse, resuming: boolean) => void>(() => {});

  const clearPlayback = useCallback(() => {
    for (const source of playbackSourcesRef.current) {
      try {
        source.stop();
      } catch {
        // A source that already ended needs no further cleanup.
      }
    }
    playbackSourcesRef.current.clear();
    nextPlaybackTimeRef.current = 0;
    setOutputLevel(0);
  }, []);

  const setFocusMode = useCallback((enabled: boolean) => {
    focusModeRef.current = enabled;
    holdingToTalkRef.current = false;
    setFocusModeState(enabled);
    setHoldingToTalkState(false);
  }, []);

  const beginHoldToTalk = useCallback(() => {
    if (!focusModeRef.current || !sessionReadyRef.current) return;
    clearPlayback();
    holdingToTalkRef.current = true;
    setHoldingToTalkState(true);
    setState('listening');
  }, [clearPlayback]);

  const endHoldToTalk = useCallback(() => {
    holdingToTalkRef.current = false;
    setHoldingToTalkState(false);
  }, []);

  const interrupt = useCallback(() => {
    if (!sessionReadyRef.current) return;
    clearPlayback();
    setState('listening');
  }, [clearPlayback]);

  const releaseAudio = useCallback(() => {
    clearPlayback();

    const pipeline = audioPipelineRef.current;
    audioPipelineRef.current = null;
    if (pipeline) {
      pipeline.processor.onaudioprocess = null;
      pipeline.input.disconnect();
      pipeline.processor.disconnect();
      pipeline.silentOutput.disconnect();
      void pipeline.context.close().catch(() => {});
    }

    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    setStream(null);
  }, [clearPlayback]);

  const finishStreamingTranscript = useCallback(() => {
    setTranscript((current) => current.map((entry) => ({ ...entry, final: true })));
  }, []);

  const appendTranscript = useCallback((speaker: TranscriptEntry['speaker'], text: string) => {
    if (!text) return;

    setTranscript((current) => {
      const last = current.at(-1);
      if (last && last.speaker === speaker && !last.final) {
        const merged = text.startsWith(last.text)
          ? text
          : last.text.endsWith(text)
            ? last.text
            : `${last.text}${text}`;
        return [...current.slice(0, -1), { ...last, text: merged }];
      }

      return [
        ...current,
        {
          id: crypto.randomUUID(),
          speaker,
          text,
          final: false,
        },
      ];
    });
  }, []);

  const runToolCalls = useCallback(
    async (
      calls: Array<{ id?: string; name?: string; args?: Record<string, unknown> }>,
      socket: WebSocket,
    ) => {
      setState('using_tool');

      const responses = await Promise.all(
        calls.map(async (call): Promise<GeminiFunctionResponse> => {
          const id = call.id ?? crypto.randomUUID();
          const name = call.name ?? 'unknown';
          const cached = toolResponsesRef.current.get(id);
          if (cached) return cached;

          let response: Record<string, unknown>;
          try {
            const result = await fetch('/api/atlas/tool', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ callId: id, toolName: name, arguments: call.args ?? {} }),
            });
            const body = (await result.json().catch(() => null)) as Record<string, unknown> | null;
            response = result.ok
              ? { output: body ?? { ok: true } }
              : { error: typeof body?.error === 'string' ? body.error : 'Atlas could not use that tool.' };
          } catch {
            response = { error: 'Atlas could not reach its tool service. Nothing was retried.' };
          }

          const completed = { id, name, response };
          toolResponsesRef.current.set(id, completed);
          return completed;
        }),
      );

      if (socketRef.current === socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(createToolResponseMessage(responses)));
        setState('understanding');
      }
    },
    [],
  );

  const playPcmAudio = useCallback((base64: string, mimeType?: string) => {
    const context = audioPipelineRef.current?.context;
    if (!context || context.state === 'closed') return;

    const samples = base64Pcm16ToFloatAudio(base64);
    if (samples.length === 0) return;

    let energy = 0;
    for (const sample of samples) energy += sample * sample;
    setOutputLevel(Math.min(1, Math.sqrt(energy / samples.length) * 2.4));

    const sampleRate = sampleRateFromMimeType(mimeType);
    const buffer = context.createBuffer(1, samples.length, sampleRate);
    buffer.getChannelData(0).set(samples);

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);

    const startAt = Math.max(context.currentTime + 0.02, nextPlaybackTimeRef.current);
    nextPlaybackTimeRef.current = startAt + buffer.duration;
    playbackSourcesRef.current.add(source);
    source.addEventListener(
      'ended',
      () => {
        playbackSourcesRef.current.delete(source);
        if (playbackSourcesRef.current.size === 0 && sessionReadyRef.current) {
          setOutputLevel(0);
          setState('listening');
        }
      },
      { once: true },
    );
    source.start(startAt);
  }, []);

  const ensureAudioPipeline = useCallback(async (mediaStream: MediaStream) => {
    if (audioPipelineRef.current) return;

    const context = new AudioContext({ latencyHint: 'interactive' });
    await context.resume();

    const input = context.createMediaStreamSource(mediaStream);
    // ScriptProcessor is broadly supported, including Safari. Its callback is
    // used only for short PCM chunks and never performs network setup.
    const processor = context.createScriptProcessor(4096, 1, 1);
    const silentOutput = context.createGain();
    silentOutput.gain.value = 0;

    processor.onaudioprocess = (event) => {
      const socket = socketRef.current;
      if (
        !sessionReadyRef.current ||
        !socket ||
        socket.readyState !== WebSocket.OPEN ||
        playbackSourcesRef.current.size > 0 ||
        (focusModeRef.current && !holdingToTalkRef.current)
      ) return;

      const channel = event.inputBuffer.getChannelData(0);
      const downsampled = downsampleAudio(channel, context.sampleRate);
      const base64 = bytesToBase64(floatAudioToPcm16(downsampled));
      socket.send(JSON.stringify(createRealtimeAudioMessage(base64)));
    };

    input.connect(processor);
    processor.connect(silentOutput);
    silentOutput.connect(context.destination);
    audioPipelineRef.current = { context, input, processor, silentOutput };
  }, []);

  const stop = useCallback(() => {
    intentionalStopRef.current = true;
    holdingToTalkRef.current = false;
    setHoldingToTalkState(false);
    sessionReadyRef.current = false;
    startInFlightRef.current = false;
    credentialsRef.current = null;
    resumeHandleRef.current = null;
    reconnectAttemptsRef.current = 0;
    toolResponsesRef.current.clear();

    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;

    const socket = socketRef.current;
    socketRef.current = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'Session ended');

    finishStreamingTranscript();
    releaseAudio();
    setError(null);
    setState('idle');
  }, [finishStreamingTranscript, releaseAudio]);

  const connect = useCallback(
    (credentials: LiveTokenResponse, resuming: boolean) => {
      if (intentionalStopRef.current) return;

      setState(resuming ? 'reconnecting' : 'connecting');
      sessionReadyRef.current = false;

      const socket = new WebSocket(createLiveWebSocketUrl(credentials.token));
      socketRef.current = socket;
      let setupTimeout: ReturnType<typeof setTimeout> | null = null;

      const clearSetupTimeout = () => {
        if (setupTimeout) clearTimeout(setupTimeout);
        setupTimeout = null;
      };

      socket.addEventListener('open', () => {
        if (socketRef.current !== socket || intentionalStopRef.current) return;
        socket.send(JSON.stringify(createLiveSetupMessage(credentials.sessionConfig, resumeHandleRef.current)));
        setupTimeout = setTimeout(() => {
          if (socketRef.current === socket && !sessionReadyRef.current) {
            socket.close(4000, 'Setup acknowledgement timed out');
          }
        }, SETUP_TIMEOUT_MS);
      });

      socket.addEventListener('message', async (event) => {
        if (socketRef.current !== socket || intentionalStopRef.current) return;
        const message = await parseLiveServerMessage(event.data);
        if (!message) return;

        if (message.setupComplete) {
          clearSetupTimeout();
          sessionReadyRef.current = true;
          if (!resuming) reconnectAttemptsRef.current = 0;
          setError(null);
          setState('listening');
          void audioPipelineRef.current?.context.resume().catch(() => {});
        }

        const resumption = message.sessionResumptionUpdate;
        if (resumption?.resumable && resumption.newHandle) {
          resumeHandleRef.current = resumption.newHandle;
        }

        const functionCalls = message.toolCall?.functionCalls;
        if (functionCalls?.length) {
          await runToolCalls(functionCalls, socket);
        }

        const content = message.serverContent;
        if (!content) return;

        if (content.interrupted) {
          clearPlayback();
          setState('listening');
        }

        const inputText = content.inputTranscription?.text;
        if (inputText) {
          appendTranscript('you', normaliseAtlasAddress(inputText));
          setState('understanding');
        }

        const outputText = content.outputTranscription?.text;
        if (outputText) appendTranscript('atlas', outputText);

        for (const part of content.modelTurn?.parts ?? []) {
          const audio = part.inlineData;
          if (audio?.data) {
            setState('speaking');
            playPcmAudio(audio.data, audio.mimeType);
          }
        }

        if (content.turnComplete) {
          finishStreamingTranscript();
          if (playbackSourcesRef.current.size === 0) setState('listening');
        }
      });

      socket.addEventListener('close', (event) => {
        clearSetupTimeout();
        // A late event from a deliberately closed socket must never tear down
        // a newer session the user has already started.
        if (socketRef.current !== socket) return;
        socketRef.current = null;
        if (intentionalStopRef.current) return;

        sessionReadyRef.current = false;
        clearPlayback();

        const canResume = canResumeLiveSession({
          attempts: reconnectAttemptsRef.current,
          expiresAt: credentials.sessionConfig.expiresAt,
          maxAttempts: MAX_RESUME_ATTEMPTS,
          resumeHandle: resumeHandleRef.current,
        });

        if (canResume) {
          const attempt = reconnectAttemptsRef.current;
          reconnectAttemptsRef.current += 1;
          setState('reconnecting');
          reconnectTimerRef.current = setTimeout(
            () => connectRef.current(credentials, true),
            RESUME_BASE_DELAY_MS * 2 ** attempt,
          );
          return;
        }

        credentialsRef.current = null;
        releaseAudio();
        setState('error');
        setError(
          event.code === 4000
            ? 'Google did not finish the voice handshake. Verify the Live model and API access.'
            : event.code === 1008
            ? 'Google rejected the voice configuration. Check the configured Gemini Live model.'
            : 'The voice connection closed before Atlas was ready. Try once more in a moment.',
        );
      });

      socket.addEventListener('error', () => {
        // `close` owns retry and user messaging so one failure cannot trigger
        // two reconnection paths.
        if (socketRef.current !== socket) return;
        sessionReadyRef.current = false;
      });
    },
    [appendTranscript, clearPlayback, finishStreamingTranscript, playPcmAudio, releaseAudio, runToolCalls],
  );

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  const start = useCallback(async () => {
    if (startInFlightRef.current || socketRef.current) return;
    startInFlightRef.current = true;
    intentionalStopRef.current = false;
    reconnectAttemptsRef.current = 0;
    resumeHandleRef.current = null;
    toolResponsesRef.current.clear();
    setError(null);
    setTranscript([]);

    setState('requesting_permission');
    let mediaStream: MediaStream;
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = mediaStream;
      setStream(mediaStream);
      await ensureAudioPipeline(mediaStream);
    } catch {
      startInFlightRef.current = false;
      releaseAudio();
      setState('error');
      setError(
        'Microphone access was denied. Enable it in your browser settings, then try again.',
      );
      return;
    }

    setState('connecting');
    try {
      const response = await fetch('/api/gemini/live-token', { method: 'POST' });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        releaseAudio();
        setState('error');
        setError(body.error ?? 'Could not start a voice session.');
        return;
      }

      const credentials = (await response.json()) as LiveTokenResponse;
      credentialsRef.current = credentials;
      connect(credentials, false);
    } catch {
      releaseAudio();
      setState('error');
      setError('Could not reach Atlas. Check your connection and try again.');
    } finally {
      startInFlightRef.current = false;
    }
  }, [connect, ensureAudioPipeline, releaseAudio]);

  useEffect(
    () => () => {
      intentionalStopRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'Page closed');

      const pipeline = audioPipelineRef.current;
      audioPipelineRef.current = null;
      if (pipeline) {
        pipeline.processor.onaudioprocess = null;
        pipeline.input.disconnect();
        pipeline.processor.disconnect();
        pipeline.silentOutput.disconnect();
        void pipeline.context.close().catch(() => {});
      }
      for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    },
    [],
  );

  return {
    state,
    transcript,
    error,
    stream,
    outputLevel,
    focusMode,
    holdingToTalk,
    start,
    stop,
    interrupt,
    setFocusMode,
    beginHoldToTalk,
    endHoldToTalk,
    setTranscript,
  };
}
