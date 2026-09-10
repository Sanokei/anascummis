import { fail, ok, type Result } from '@shared/types';
import type { Env } from '../env';

/**
 * Whisper transcription.
 *
 * Two behaviours here come straight from the specification:
 *   - the raw transcript is preserved separately from interpreted meaning, so
 *     this module returns text and evidence and interprets nothing;
 *   - ordinary conversational phrases are never categorically discarded. A
 *     chunk is suppressed only on capture evidence (near-silent audio, a
 *     duplicate of the previous chunk, or the assistant's own playback), not
 *     because the words happen to be "thank you" or "bye".
 */

export interface TranscriptionInput {
  audio: ArrayBuffer;
  mimeType: string;
  /** Correct names and currently relevant terms. A hint, never a rewrite rule. */
  vocabularyHint?: string;
  language?: string;
  signal?: AbortSignal;
}

export interface TranscriptionResult {
  text: string;
  provider: 'workers-ai' | 'openai';
  model: string;
  durationSeconds: number | null;
  /** Present when the provider reports one. Not a calibrated probability. */
  confidence: number | null;
}

export interface SuppressionEvidence {
  /** Peak absolute amplitude, 0 to 1, measured client-side. */
  peakAmplitude: number;
  /** Root-mean-square amplitude, 0 to 1. */
  rmsAmplitude: number;
  /** True when the assistant was audibly playing during capture. */
  duringPlayback: boolean;
  /** True when the client detected echo of its own output. */
  echoDetected: boolean;
  /** sha-256 of the previous accepted chunk, for duplicate detection. */
  previousChunkHash: string | null;
  chunkHash: string;
  durationMs: number;
}

export type SuppressionDecision =
  | { suppress: false }
  | { suppress: true; reason: 'silence' | 'duplicate-chunk' | 'echo' | 'too-short' };

/**
 * Decides whether a captured chunk should produce a turn at all.
 *
 * The iJester word filter this replaces discarded complete utterances such as
 * "thank you" and "bye". Those are valid conversational inputs, so no decision
 * here inspects the transcript text.
 */
export function shouldSuppressChunk(evidence: SuppressionEvidence): SuppressionDecision {
  if (evidence.durationMs < 180) return { suppress: true, reason: 'too-short' };
  if (evidence.previousChunkHash && evidence.previousChunkHash === evidence.chunkHash) {
    return { suppress: true, reason: 'duplicate-chunk' };
  }
  if (evidence.peakAmplitude < 0.012 && evidence.rmsAmplitude < 0.004) {
    return { suppress: true, reason: 'silence' };
  }
  if (evidence.duringPlayback && evidence.echoDetected && evidence.rmsAmplitude < 0.03) {
    return { suppress: true, reason: 'echo' };
  }
  return { suppress: false };
}

export function transcriptionRoute(env: Env): { provider: 'workers-ai' | 'openai' | 'none'; model: string } {
  if (env.AI && env.WORKERS_AI_TRANSCRIBE_MODEL) {
    return { provider: 'workers-ai', model: env.WORKERS_AI_TRANSCRIBE_MODEL };
  }
  // OpenAI's hosted whisper-1 does not support file streaming, so this path
  // sends complete bounded chunks rather than assuming a stream.
  if (env.OPENAI_API_KEY) return { provider: 'openai', model: 'whisper-1' };
  return { provider: 'none', model: '' };
}

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

export async function transcribe(env: Env, input: TranscriptionInput): Promise<Result<TranscriptionResult>> {
  if (input.audio.byteLength === 0) return fail('invalid-argument', 'No audio was supplied.');
  if (input.audio.byteLength > MAX_AUDIO_BYTES) {
    return fail('invalid-argument', `Audio chunk exceeds the ${MAX_AUDIO_BYTES} byte ceiling.`);
  }

  const route = transcriptionRoute(env);
  if (route.provider === 'none') {
    return fail(
      'missing-credential',
      'No transcription provider is available. Bind Workers AI or set OPENAI_API_KEY.',
    );
  }
  if (route.provider === 'workers-ai') return workersAiTranscribe(env, route.model, input);
  return openAiTranscribe(env, route.model, input);
}

async function workersAiTranscribe(
  env: Env,
  model: string,
  input: TranscriptionInput,
): Promise<Result<TranscriptionResult>> {
  if (!env.AI) return fail('missing-credential', 'Workers AI is not bound.');
  try {
    const payload: Record<string, unknown> = {
      audio: base64(input.audio),
    };
    if (input.vocabularyHint) payload.prompt = input.vocabularyHint;
    if (input.language) payload.language = input.language;

    const raw = (await env.AI.run(model as never, payload as never)) as {
      text?: string;
      transcription_info?: { duration?: number; language_probability?: number };
    };
    const text = (raw.text ?? '').trim();
    return ok({
      text,
      provider: 'workers-ai',
      model,
      durationSeconds: raw.transcription_info?.duration ?? null,
      confidence: raw.transcription_info?.language_probability ?? null,
    });
  } catch (err) {
    return fail('upstream-error', `Transcription failed: ${String(err)}`);
  }
}

async function openAiTranscribe(
  env: Env,
  model: string,
  input: TranscriptionInput,
): Promise<Result<TranscriptionResult>> {
  const form = new FormData();
  form.append('file', new Blob([input.audio], { type: input.mimeType }), 'chunk.webm');
  form.append('model', model);
  form.append('response_format', 'json');
  if (input.vocabularyHint) form.append('prompt', input.vocabularyHint);
  if (input.language) form.append('language', input.language);

  try {
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: form,
      signal: input.signal,
    });
    if (!res.ok) {
      return fail('upstream-error', `Transcription provider returned ${res.status}.`);
    }
    const parsed = (await res.json()) as { text?: string };
    return ok({
      text: (parsed.text ?? '').trim(),
      provider: 'openai',
      model,
      durationSeconds: null,
      confidence: null,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return fail('cancelled', 'Transcription was cancelled.');
    }
    return fail('upstream-error', `Transcription failed: ${String(err)}`);
  }
}

function base64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(out);
}

/** Short vocabulary hint. Names are supplied for recognition, not substitution. */
export function buildVocabularyHint(extraTerms: string[] = []): string {
  const base = ['Anascummis', 'Anas', 'Cummis', 'Ink', 'Lua', 'Cloudflare', 'Worker', 'DeepSeek', 'Whisper'];
  const terms = [...base, ...extraTerms.filter((t) => t.length > 1)].slice(0, 32);
  return terms.join(', ');
}
