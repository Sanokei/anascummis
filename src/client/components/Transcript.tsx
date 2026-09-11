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
 * The conversation.
 *
 * The two speakers are told apart by *form* rather than by labels. There is no
 * "You" and "Anascummis" above each turn: the assistant's reply is the page's
 * own voice — full ink, at reading size — and what you said sits inset, dimmer
 * and smaller, the way a quotation is set apart from the text around it. A
 * speaker label on every turn is furniture; the indent does the same job
 * without being read twice.
 *
 * Screen readers are not left to infer it: every turn carries an `aria-label`
 * naming who said it, and the visual distinction is not load-bearing for
 * anyone who cannot see it.
 */
export function Transcript({
  turns,
  citations,
  choices,
  busy,
  streamingText,
  partialTranscript,
  onChoose,
}: TranscriptProps) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [turns.length, choices.length, streamingText?.length, partialTranscript?.length]);

  return (
    <div className="flex flex-col gap-7">
      {turns.length === 0 && !streamingText && !partialTranscript && (
        <p className="prose-voice text-ink-dim mx-auto text-[1.02rem]">
          Say something, or type it. Ordinary conversation is fine. Nothing gets built unless you
          ask for it.
        </p>
      )}

      {turns.map((turn) =>
        turn.role === 'user' ? (
          <UserTurn key={turn.id} turn={turn} />
        ) : (
          <AssistantTurn key={turn.id} turn={turn} />
        ),
      )}

      {partialTranscript ? (
        <article aria-label="You said" className="border-hairline mr-auto border-l pl-5">
          <p className="prose-voice text-ink-dim text-[0.95rem]">
            {partialTranscript}
            <span className="caret" aria-hidden="true" />
          </p>
        </article>
      ) : null}

      {streamingText ? (
        <article aria-label="Anascummis said">
          <p className="prose-voice whitespace-pre-wrap">
            {streamingText}
            <span className="caret" aria-hidden="true" />
          </p>
        </article>
      ) : null}

      {citations.length > 0 && <Sources citations={citations} />}

      {choices.length > 0 && (
        <section aria-label="Choices" className="flex flex-col">
          <h2 className="text-ink-faint mb-3 text-[0.82rem]">Or pick one</h2>
          <ul className="flex flex-col">
            {choices.map((choice) => (
              <li key={choice.index}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onChoose(choice.index)}
                  className="border-hairline hover:border-signal hover:bg-ground-raised group flex w-full items-baseline justify-between gap-4 border-b px-1 py-3 text-left transition-colors disabled:opacity-50"
                >
                  <span className="group-hover:text-signal transition-colors">{choice.text}</span>
                  {choice.risk !== 'none' && (
                    <span
                      className={`shrink-0 font-mono text-[0.68rem] ${
                        choice.risk === 'irreversible' || choice.risk === 'high'
                          ? 'text-caution'
                          : 'text-ink-faint'
                      }`}
                    >
                      {choice.risk}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div ref={endRef} />
    </div>
  );
}

function AssistantTurn({ turn }: { turn: Turn }) {
  return (
    <article aria-label="Anascummis said">
      <p className="prose-voice text-[1.06rem] whitespace-pre-wrap">{turn.text}</p>
      {/*
        A line reused verbatim from the authored personality is marked, so it is
        never mistaken for something composed for this moment.
      */}
      {turn.authoredLineId && (
        <p
          className="text-ink-faint mt-1.5 font-mono text-[0.7rem]"
          title="An approved authored line"
        >
          authored · {turn.authoredLineId}
        </p>
      )}
    </article>
  );
}

function UserTurn({ turn }: { turn: Turn }) {
  return (
    <article aria-label="You said" className="border-hairline ml-auto max-w-[52ch] border-r pr-5">
      <p className="prose-voice text-ink-dim text-[0.95rem] whitespace-pre-wrap">{turn.text}</p>
      {/*
        The raw transcript is kept and shown separately from what the turn was
        taken to mean, and only when the two differ.
      */}
      {turn.rawTranscript && turn.rawTranscript !== turn.text && (
        <details className="mt-1.5">
          <summary className="text-ink-faint hover:text-ink-dim cursor-pointer font-mono text-[0.7rem]">
            Heard
          </summary>
          <p className="text-ink-faint mt-1 font-mono text-[0.74rem]">{turn.rawTranscript}</p>
        </details>
      )}
    </article>
  );
}

/**
 * Retrieved sources.
 *
 * Set apart from the reply and never woven into it. A citation the reader
 * cannot check is a claim, and the point of showing these is that every one of
 * them can be opened.
 */
function Sources({ citations }: { citations: Citation[] }) {
  return (
    <section aria-label="Sources" className="border-hairline border-t pt-4">
      <h2 className="text-ink-faint mb-2.5 text-[0.82rem]">Sources</h2>
      <ul className="flex flex-col gap-2.5">
        {citations.map((citation) => (
          <li key={citation.url} className="text-[0.88rem]">
            <a
              href={citation.url}
              target="_blank"
              rel="noreferrer noopener"
              className="text-signal decoration-signal-dim underline underline-offset-2"
            >
              {citation.title}
            </a>
            {citation.snippet && (
              <p className="text-ink-faint mt-0.5 prose-voice text-[0.84rem]">{citation.snippet}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
