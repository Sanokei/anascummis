import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';

/**
 * Microphone capture.
 *
 * Capture requires an explicit activation and the browser's own permission,
 * shows visible status, and stops immediately on request. Stopping releases
 * the device tracks rather than merely ignoring them, because a saved boolean
 * must never be able to reopen a microphone on its own.
 *
 * Every chunk carries the capture evidence the host uses to decide whether to
 * suppress it: peak and RMS amplitude, whether playback was active, and
 * whether the client detected echo. Suppression never inspects the words.
 */

export type MicStatus = 'off' | 'requesting' | 'listening' | 'denied' | 'unsupported' | 'error';

interface UseMicOptions {
  /** Called with a usable transcript. Suppressed chunks never reach it. */
  onTranscript: (text: string, raw: string) => void;
  /** True while the assistant's own audio is playing. */
  playbackActive: () => boolean;
  vocabulary: string[];
}

const MAX_BUFFER_MS = 7000;
const RECORD_CHUNK_MS = 700;
const SILENCE_FLUSH_MS = 700;
const MIN_BUFFER_MS = 250;
/** Minimum accumulated speech before a partial transcript is sent. */
const MIN_PARTIAL_MS = 500;
/** Smallest gap between partial transcripts while the user keeps speaking. */
const PARTIAL_INTERVAL_MS = 1000;

interface BufferedChunk {
  blob: Blob;
  durationMs: number;
  peakAmplitude: number;
  rmsAmplitude: number;
  duringPlayback: boolean;
  echoDetected: boolean;
}

export function useMic({ onTranscript, playbackActive, vocabulary }: UseMicOptions) {
  const [status, setStatus] = useState<MicStatus>('off');
  const [level, setLevel] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  /** Live partial transcript, streamed while the user is still speaking. */
  const [partialText, setPartialText] = useState('');

  const streamRef = useRef<MediaStream | null>(null);
  const partialSeqRef = useRef(0);
  const lastPartialAtRef = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const peakRef = useRef(0);
  const sumSquaresRef = useRef(0);
  const sampleCountRef = useRef(0);
  const echoRef = useRef(false);
  const audioMimeRef = useRef('audio/webm');
  const bufferedChunksRef = useRef<BufferedChunk[]>([]);
  const bufferedDurationMsRef = useRef(0);
  const lastSpeechAtRef = useRef(0);
  const flushTimeoutRef = useRef<number | null>(null);
  const inSpeechSegmentRef = useRef(false);

  const releaseDevice = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    recorderRef.current?.state !== 'inactive' && recorderRef.current?.stop();
    recorderRef.current = null;
    // Stopping every track is what actually turns the indicator light off.
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    void audioCtxRef.current?.close();
    audioCtxRef.current = null;
    analyserRef.current = null;
    bufferedChunksRef.current = [];
    bufferedDurationMsRef.current = 0;
    inSpeechSegmentRef.current = false;
    lastSpeechAtRef.current = 0;
    if (flushTimeoutRef.current !== null) {
      clearTimeout(flushTimeoutRef.current);
      flushTimeoutRef.current = null;
    }
    setLevel(0);
    setPartialText('');
  }, []);

  /**
   * Sends captured audio for transcription. A partial runs while the user is
   * still speaking and only updates the live transcript; a final runs at the
   * end of an utterance and becomes the turn.
   */
  const sendChunks = useCallback(
    async (chunks: BufferedChunk[], durationMs: number, kind: 'partial' | 'final') => {
      if (chunks.length === 0) return;
      // A later chunk supersedes this one, so a stale partial response is dropped.
      const seq = ++partialSeqRef.current;

      const peakAmplitude = Math.max(...chunks.map((chunk) => chunk.peakAmplitude));
      const rmsAmplitude = Math.sqrt(
        chunks.reduce((sum, chunk) => sum + chunk.rmsAmplitude * chunk.rmsAmplitude * chunk.durationMs, 0) /
          Math.max(durationMs, 1),
      );
      const duringPlayback = chunks.some((chunk) => chunk.duringPlayback);
      const echoDetected = chunks.some((chunk) => chunk.echoDetected);
      const audio = new Blob(chunks.map((chunk) => chunk.blob), { type: audioMimeRef.current });

      const form = new FormData();
      form.append('audio', audio, `chunk.${audioExtension(audioMimeRef.current)}`);
      form.append('audioMimeType', audioMimeRef.current);
      form.append('peakAmplitude', String(peakAmplitude));
      form.append('rmsAmplitude', String(rmsAmplitude));
      form.append('duringPlayback', String(duringPlayback));
      form.append('echoDetected', String(echoDetected));
      form.append('durationMs', String(durationMs));
      form.append('vocabulary', vocabulary.join(','));

      try {
        const result = await api.transcribe(form);
        if (kind === 'partial' && seq !== partialSeqRef.current) return;
        if (result.suppressed || !result.text.trim()) {
          if (kind === 'final') setPartialText('');
          return;
        }
        if (kind === 'partial') {
          setPartialText(result.text);
        } else {
          setPartialText('');
          onTranscript(result.text, result.rawTranscript ?? result.text);
        }
      } catch (err) {
        if (kind === 'final') {
          setPartialText('');
          setNote(err instanceof Error ? err.message : 'That chunk could not be transcribed.');
        }
      }
    },
    [onTranscript, vocabulary],
  );

  /** A live snapshot of the utterance so far, without ending the segment. */
  const sendPartial = useCallback(() => {
    const durationMs = bufferedDurationMsRef.current;
    if (durationMs < MIN_PARTIAL_MS) return;
    void sendChunks(bufferedChunksRef.current.slice(), durationMs, 'partial');
  }, [sendChunks]);

  const flushBuffer = useCallback(
    async (force = false) => {
      const chunks = bufferedChunksRef.current;
      if (!chunks.length) return;
      const durationMs = bufferedDurationMsRef.current;
      if (!force && durationMs < MIN_BUFFER_MS) {
        bufferedChunksRef.current = [];
        bufferedDurationMsRef.current = 0;
        inSpeechSegmentRef.current = false;
        lastSpeechAtRef.current = 0;
        return;
      }

      bufferedChunksRef.current = [];
      bufferedDurationMsRef.current = 0;
      inSpeechSegmentRef.current = false;
      lastSpeechAtRef.current = 0;

      await sendChunks(chunks, durationMs, 'final');
    },
    [sendChunks],
  );

  const scheduleFlush = useCallback(() => {
    if (flushTimeoutRef.current !== null) clearTimeout(flushTimeoutRef.current);
    flushTimeoutRef.current = window.setTimeout(() => {
      if (lastSpeechAtRef.current === 0) return;
      const sinceSpeech = performance.now() - lastSpeechAtRef.current;
      if (!Number.isFinite(sinceSpeech) || sinceSpeech >= SILENCE_FLUSH_MS) {
        void flushBuffer();
      }
    }, SILENCE_FLUSH_MS);
  }, [flushBuffer]);

  const stop = useCallback(async () => {
    if (inSpeechSegmentRef.current) {
      await flushBuffer(true);
    } else {
      bufferedChunksRef.current = [];
      bufferedDurationMsRef.current = 0;
      inSpeechSegmentRef.current = false;
    }
    lastSpeechAtRef.current = 0;
    releaseDevice();
    setStatus('off');
    await api.setListening(false).catch(() => undefined);
  }, [flushBuffer, releaseDevice]);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setStatus('unsupported');
      setNote('This browser cannot capture audio. Typing works exactly the same.');
      return;
    }

    setStatus('requesting');
    setNote(null);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      setStatus(name === 'NotAllowedError' ? 'denied' : 'error');
      setNote(
        name === 'NotAllowedError'
          ? 'The browser refused microphone access. You can grant it in the site settings, or just type.'
          : 'The microphone could not be opened. Typing works exactly the same.',
      );
      return;
    }

    streamRef.current = stream;

    const audioCtx = new AudioContext();
    audioCtxRef.current = audioCtx;
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    analyserRef.current = analyser;

    const buffer = new Float32Array(analyser.fftSize);
    const measure = () => {
      analyser.getFloatTimeDomainData(buffer);
      let peak = 0;
      let sum = 0;
      for (const sample of buffer) {
        const abs = Math.abs(sample);
        if (abs > peak) peak = abs;
        sum += sample * sample;
      }
      const rms = Math.sqrt(sum / buffer.length);
      peakRef.current = Math.max(peakRef.current, peak);
      sumSquaresRef.current += sum;
      sampleCountRef.current += buffer.length;
      // Echo is inferred from level rising while our own audio plays.
      if (playbackActive() && rms > 0.01) echoRef.current = true;
      setLevel(Math.min(1, rms * 6));
      rafRef.current = requestAnimationFrame(measure);
    };
    measure();

    const mime = pickMimeType();
    audioMimeRef.current = mime ?? 'audio/webm';
    lastSpeechAtRef.current = 0;
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recorderRef.current = recorder;

    recorder.ondataavailable = async (event) => {
      if (event.data.size < 1200) return;

      const peak = peakRef.current;
      const rms = sampleCountRef.current > 0 ? Math.sqrt(sumSquaresRef.current / sampleCountRef.current) : 0;
      const duringPlayback = playbackActive();
      const echo = echoRef.current;
      peakRef.current = 0;
      sumSquaresRef.current = 0;
      sampleCountRef.current = 0;
      echoRef.current = false;

      const speaking = peak > 0.012 || rms > 0.004;
      if (speaking) {
        if (!inSpeechSegmentRef.current) {
          bufferedChunksRef.current = [];
          bufferedDurationMsRef.current = 0;
          inSpeechSegmentRef.current = true;
          lastPartialAtRef.current = 0;
        }
        lastSpeechAtRef.current = performance.now();
        bufferedChunksRef.current.push({
          blob: event.data,
          durationMs: RECORD_CHUNK_MS,
          peakAmplitude: peak,
          rmsAmplitude: rms,
          duringPlayback,
          echoDetected: echo,
        });
        bufferedDurationMsRef.current += RECORD_CHUNK_MS;
        while (bufferedDurationMsRef.current > MAX_BUFFER_MS) {
          const removed = bufferedChunksRef.current.shift();
          if (removed) {
            bufferedDurationMsRef.current = Math.max(0, bufferedDurationMsRef.current - removed.durationMs);
          }
        }
        if (performance.now() - lastPartialAtRef.current >= PARTIAL_INTERVAL_MS) {
          lastPartialAtRef.current = performance.now();
          sendPartial();
        }
        if (flushTimeoutRef.current !== null) {
          clearTimeout(flushTimeoutRef.current);
          flushTimeoutRef.current = null;
        }
        return;
      }
      if (inSpeechSegmentRef.current) {
        bufferedChunksRef.current.push({
          blob: event.data,
          durationMs: RECORD_CHUNK_MS,
          peakAmplitude: peak,
          rmsAmplitude: rms,
          duringPlayback,
          echoDetected: echo,
        });
        bufferedDurationMsRef.current += RECORD_CHUNK_MS;
        while (bufferedDurationMsRef.current > MAX_BUFFER_MS) {
          const removed = bufferedChunksRef.current.shift();
          if (removed) {
            bufferedDurationMsRef.current = Math.max(0, bufferedDurationMsRef.current - removed.durationMs);
          }
        }
        scheduleFlush();
      }
    };

    recorder.start(RECORD_CHUNK_MS);
    setStatus('listening');
    await api.setListening(true).catch(() => undefined);
  }, [playbackActive, scheduleFlush, sendPartial]);

  // Releasing on unmount matters: a navigation must not leave the mic open.
  useEffect(() => releaseDevice, [releaseDevice]);

  return { status, level, note, partial: partialText, start, stop };
}

function pickMimeType(): string | null {
  for (const candidate of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
    if (MediaRecorder.isTypeSupported?.(candidate)) return candidate;
  }
  return null;
}

function audioExtension(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.startsWith('audio/mp4')) return 'm4a';
  if (normalized.startsWith('audio/webm')) return 'webm';
  if (normalized.startsWith('audio/ogg')) return 'ogg';
  return 'webm';
}
