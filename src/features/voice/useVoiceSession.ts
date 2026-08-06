'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { LiveTokenResponse, TranscriptEntry, VoiceState } from '@/features/voice/types';

/**
 * Voice session lifecycle.
 *
 * The token is minted immediately before connecting, never at page load: its
 * new-session window is about a minute, so a token fetched when the page
 * rendered would already be dead by the time anyone clicked.
 *
 * NOT exercised against the live Gemini WebSocket in this codebase — that
 * needs a GEMINI_API_KEY. The token fetch, permission handling, state machine
 * and teardown are real; the transport is wired but unverified, and README
 * says so.
 */
export function useVoiceSession() {
  const [state, setState] = useState<VoiceState>('idle');
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  /**
   * Exposed so the core can visualise REAL audio. It is the same object the
   * teardown stops, so when the microphone goes off the visual stops with it —
   * the UI cannot show "listening" while nothing is being captured.
   */
  const [stream, setStream] = useState<MediaStream | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  /**
   * Reconnection has to re-enter `start`, but a callback cannot reference
   * itself in its own dependency list. The ref breaks that cycle without
   * making the identity of `start` unstable.
   */
  const startRef = useRef<() => Promise<void>>(async () => {});
  const socketRef = useRef<WebSocket | null>(null);
  const resumeHandleRef = useRef<string | null>(null);

  /**
   * Release the microphone.
   *
   * Stopping every track is what turns the browser's recording indicator off.
   * Dropping the reference without this leaves the light on, which would make
   * the interface a liar about whether it is listening.
   */
  const releaseMicrophone = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) {
      track.stop();
    }
    streamRef.current = null;
    setStream(null);
  }, []);

  const stop = useCallback(() => {
    socketRef.current?.close();
    socketRef.current = null;
    releaseMicrophone();
    resumeHandleRef.current = null;
    setState('idle');
  }, [releaseMicrophone]);

  const start = useCallback(async () => {
    setError(null);

    // 1. Microphone permission, requested at the moment of use with the
    //    reason on screen — never on page load.
    setState('requesting_permission');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setStream(stream);
    } catch {
      setState('error');
      setError(
        'Microphone access was denied. Enable it in your browser settings, or use text instead.',
      );
      return;
    }

    // 2. Mint the token NOW.
    setState('connecting');
    let credentials: LiveTokenResponse;
    try {
      const response = await fetch('/api/gemini/live-token', { method: 'POST' });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        releaseMicrophone();
        setState('error');
        setError(body.error ?? 'Could not start a voice session.');
        return;
      }

      credentials = (await response.json()) as LiveTokenResponse;
    } catch {
      releaseMicrophone();
      setState('error');
      setError('Could not reach Atlas. Check your connection and try again.');
      return;
    }

    // 3. Connect directly to Gemini Live with the ephemeral token. The
    //    permanent key is never involved on this side of the boundary.
    try {
      const url = new URL(
        'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent',
      );
      url.searchParams.set('access_token', credentials.token);

      const socket = new WebSocket(url.toString());
      socketRef.current = socket;

      socket.addEventListener('open', () => {
        setState('listening');
        socket.send(
          JSON.stringify({
            setup: {
              model: `models/${credentials.sessionConfig.model}`,
              generationConfig: {
                responseModalities: credentials.sessionConfig.responseModalities,
              },
              // Lets a dropped connection resume rather than losing the
              // conversation. Live connections last about ten minutes.
              sessionResumption: resumeHandleRef.current
                ? { handle: resumeHandleRef.current }
                : {},
              inputAudioTranscription: {},
              outputAudioTranscription: {},
            },
          }),
        );
      });

      socket.addEventListener('close', (event) => {
        // 1000 is a deliberate close. Anything else mid-session is the ~10
        // minute lifetime expiring, so resume rather than ending.
        if (event.code !== 1000 && streamRef.current) {
          setState('reconnecting');
          void startRef.current();
        } else {
          stop();
        }
      });

      socket.addEventListener('error', () => {
        setState('error');
        setError('The voice connection dropped. You can try again, or use text.');
      });
    } catch {
      releaseMicrophone();
      setState('error');
      setError('Could not open the voice connection.');
    }
  }, [releaseMicrophone, stop]);

  // Assigned in an effect, not during render: mutating a ref while rendering
  // is not safe under concurrent rendering.
  useEffect(() => {
    startRef.current = start;
  }, [start]);

  return { state, transcript, error, stream, start, stop, setTranscript };
}
