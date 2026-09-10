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

const CHUNK_MS = 3200;

export function useMic({ onTranscript, playbackActive, vocabulary }: UseMicOptions) {
  const [status, setStatus] = useState<MicStatus>('off');
  const [level, setLevel] = useState(0);
  const [note, setNote] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const peakRef = useRef(0);
  const sumSquaresRef = useRef(0);
  const sampleCountRef = useRef(0);
  const echoRef = useRef(false);

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
    setLevel(0);
  }, []);

  const stop = useCallback(async () => {
    releaseDevice();
    setStatus('off');
    await api.setListening(false).catch(() => undefined);
  }, [releaseDevice]);

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

      const form = new FormData();
      form.append('audio', event.data, 'chunk.webm');
      form.append('peakAmplitude', String(peak));
      form.append('rmsAmplitude', String(rms));
      form.append('duringPlayback', String(duringPlayback));
      form.append('echoDetected', String(echo));
      form.append('durationMs', String(CHUNK_MS));
      form.append('vocabulary', vocabulary.join(','));

      try {
        const result = await api.transcribe(form);
        if (result.suppressed || !result.text.trim()) return;
        onTranscript(result.text, result.rawTranscript ?? result.text);
      } catch (err) {
        setNote(err instanceof Error ? err.message : 'That chunk could not be transcribed.');
      }
    };

    recorder.start(CHUNK_MS);
    setStatus('listening');
    await api.setListening(true).catch(() => undefined);
  }, [onTranscript, playbackActive, vocabulary]);

  // Releasing on unmount matters: a navigation must not leave the mic open.
  useEffect(() => releaseDevice, [releaseDevice]);

  return { status, level, note, start, stop };
}

function pickMimeType(): string | null {
  for (const candidate of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
    if (MediaRecorder.isTypeSupported?.(candidate)) return candidate;
  }
  return null;
}
