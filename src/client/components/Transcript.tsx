import { useEffect, useRef } from 'react';
import type { Citation, InkChoiceView, Turn } from '@shared/types';

interface TranscriptProps {
  turns: Turn[];
  citations: Citation[];
  choices: InkChoiceView[];
  busy: boolean;
  /** The in-flight assistant reply, streamed word by word. */
  streamingText?: string | null;
  /** Live transcription of what the user is saying right now. */
  partialTranscript?: string | null;
  onChoose: (index: number) => void;
}

/**
 * The conversation. Choices are offered as buttons but never required: the
 * same branch can be reached by saying what you mean.
 */
export function Transcript({ turns, citations, choices, busy, streamingText, partialTranscript, onChoose }: TranscriptProps) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [turns.length, choices.length, streamingText?.length, partialTranscript?.length]);

  return (
    <div className="flex flex-col gap-6">
      {turns.length === 0 && (
        <p className="text-ink-faint max-w-prose text-[0.95rem]">
          Say something, or type it. Ordinary conversation is fine. Nothing gets built unless you ask
          for it.
        </p>
      )}

      {turns.map((turn) => (
        <article
          key={turn.id}
          className={turn.role === 'user' ? 'pl-6 border-l border-hairline' : ''}
          aria-label={turn.role === 'user' ? 'You said' : 'Anascummis said'}
        >
          <p className="text-ink-faint mb-1 font-mono text-[0.7rem] tracking-wide uppercase">
            {turn.role === 'user' ? 'You' : 'Anascummis'}
            {turn.authoredLineId && (
              <span className="text-signal-dim ml-2 normal-case" title="An approved authored line">
                authored · {turn.authoredLineId}
              </span>
            )}
          </p>
          <p className={`max-w-prose whitespace-pre-wrap ${turn.role === 'user' ? 'text-ink-dim' : ''}`}>
            {turn.text}
          </p>
          {/*
            The raw transcript is kept and shown separately from what the turn
            was taken to mean, and only when the two differ.
          */}
          {turn.rawTranscript && turn.rawTranscript !== turn.text && (
            <details className="mt-2">
              <summary className="text-ink-faint cursor-pointer font-mono text-[0.7rem]">
                Raw transcript
              </summary>
              <p className="text-ink-faint mt-1 font-mono text-[0.75rem]">{turn.rawTranscript}</p>
            </details>
          )}
        </article>
      ))}

      {partialTranscript ? (
        <article aria-label="You said" className="pl-6 border-l border-hairline">
          <p className="text-ink-faint mb-1 font-mono text-[0.7rem] tracking-wide uppercase">You</p>
          <p className="text-ink-dim max-w-prose whitespace-pre-wrap">
            {partialTranscript}
            <span aria-hidden="true" className="animate-pulse">
              ▍
            </span>
          </p>
        </article>
      ) : null}

      {streamingText ? (
        <article aria-label="Anascummis said">
          <p className="text-ink-faint mb-1 font-mono text-[0.7rem] tracking-wide uppercase">Anascummis</p>
          <p className="max-w-prose whitespace-pre-wrap">
            {streamingText}
            <span aria-hidden="true" className="animate-pulse">
              ▍
            </span>
          </p>
        </article>
      ) : null}

      {citations.length > 0 && (
        <section aria-label="Sources" className="border-hairline border-t pt-4">
          <h2 className="text-ink-faint mb-2 font-mono text-[0.7rem] tracking-wide uppercase">
            Sources retrieved
          </h2>
          <ul className="flex flex-col gap-2">
            {citations.map((citation) => (
              <li key={citation.url} className="text-[0.85rem]">
                <a
                  href={citation.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-signal underline decoration-signal-dim underline-offset-2"
                >
                  {citation.title}
                </a>
                {citation.snippet && <p className="text-ink-faint mt-0.5">{citation.snippet}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {choices.length > 0 && (
        <section aria-label="Choices" className="flex flex-col gap-2">
          <h2 className="text-ink-faint font-mono text-[0.7rem] tracking-wide uppercase">
            Or pick one
          </h2>
          {choices.map((choice) => (
            <button
              key={choice.index}
              type="button"
              disabled={busy}
              onClick={() => onChoose(choice.index)}
              className="border-hairline hover:border-hairline-bright bg-ground-raised group flex items-center justify-between gap-3 border px-4 py-2.5 text-left transition-colors disabled:opacity-50"
            >
              <span>{choice.text}</span>
              {choice.risk !== 'none' && (
                <span
                  className={`font-mono text-[0.65rem] tracking-wide uppercase ${
                    choice.risk === 'irreversible' || choice.risk === 'high'
                      ? 'text-caution'
                      : 'text-ink-faint'
                  }`}
                >
                  {choice.risk}
                </span>
              )}
            </button>
          ))}
        </section>
      )}

      <div ref={endRef} />
    </div>
  );
}
