import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Citation, InkChoiceView, PendingConfirmation, Turn } from '@shared/types';
import { api, ApiFailure, type SessionState } from './api';
import { Orb, type OrbState } from './components/Orb';
import { Transcript } from './components/Transcript';
import { Inspector, type InspectorTab } from './components/Inspector';
import { CookieConsent } from './components/CookieConsent';
import { Policies, type PolicyPage } from './pages/Policies';
import { useMic } from './hooks/useMic';

export function App() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [choices, setChoices] = useState<InkChoiceView[]>([]);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: string; message: string } | null>(null);
  const [draft, setDraft] = useState('');
  const [tab, setTab] = useState<InspectorTab>('status');
  const [policy, setPolicy] = useState<PolicyPage | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [streamingText, setStreamingText] = useState<string | null>(null);

  const turnAbort = useRef<AbortController | null>(null);
  const playing = useRef(false);

  const reducedMotion = session?.config.accessibility.reducedMotion ?? false;

  /* ---------------- loading ---------------- */

  useEffect(() => {
    void api
      .session()
      .then((state) => {
        setSession(state);
        setTurns(state.turns);
        setConfirmation(state.pendingConfirmation);
      })
      .catch((err: Error) => setLoadError(err.message));
  }, []);

  // Accessibility preferences apply at the root, so everything inherits them.
  useEffect(() => {
    if (!session) return;
    const root = document.documentElement;
    root.dataset.textScale = String(session.config.accessibility.textScale);
    root.style.setProperty('--text-scale', String(session.config.accessibility.textScale));
    root.dataset.contrast = session.config.accessibility.highContrast ? 'high' : 'normal';
    root.dataset.motion = session.config.accessibility.reducedMotion ? 'reduced' : 'full';
  }, [session]);

  /* ---------------- turns ---------------- */

  const send = useCallback(
    async (input: { text: string; rawTranscript?: string; choiceIndex?: number; token?: string }) => {
      setBusy(true);
      setNotice(null);
      setStreamingText('');
      turnAbort.current?.abort();
      const controller = new AbortController();
      turnAbort.current = controller;

      try {
        const response = await api.turn(
          {
            text: input.text,
            ...(input.rawTranscript ? { rawTranscript: input.rawTranscript } : {}),
            ...(typeof input.choiceIndex === 'number' ? { choiceIndex: input.choiceIndex } : {}),
            ...(input.token ? { confirmationToken: input.token } : {}),
            signal: controller.signal,
          },
          (delta) => setStreamingText((prev) => (prev ?? '') + delta),
        );
        setStreamingText(null);
        setTurns(response.turns);
        setChoices(response.choices);
        setCitations(response.citations);
        setConfirmation(response.pendingConfirmation);
        if (response.blocked) setNotice(response.blocked);
        else if (response.paused) {
          setNotice({
            kind: 'budget-exhausted',
            message: 'This turn used its budget and paused. Ask again to continue.',
          });
        }
      } catch (err) {
        setStreamingText(null);
        if (err instanceof ApiFailure) {
          setNotice({
            kind: err.detail.kind,
            message: err.detail.outcomeUnknown
              ? `${err.detail.message} The outcome is unknown, so it needs checking before a retry.`
              : err.detail.message,
          });
        } else if (!controller.signal.aborted) {
          setNotice({ kind: 'unknown', message: 'That did not go through.' });
        }
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const onTranscript = useCallback(
    (text: string, raw: string) => {
      void send({ text, rawTranscript: raw });
    },
    [send],
  );

  const vocabulary = useMemo(() => [], []);
  const mic = useMic({ onTranscript, playbackActive: () => playing.current, vocabulary });

  /* ---------------- stop ---------------- */

  const stop = useCallback(async () => {
    // Independent of the model and of Ink: abort locally first, then fence.
    turnAbort.current?.abort();
    speechSynthesis?.cancel();
    playing.current = false;
    setBusy(false);
    try {
      const result = await api.stop();
      setNotice({ kind: 'cancelled', message: result.note });
    } catch {
      setNotice({ kind: 'cancelled', message: 'Stopped locally. The server was not reachable.' });
    }
  }, []);

  // A keyboard equivalent that works without reaching the button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void stop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stop]);

  /* ---------------- orb ---------------- */

  const orbState: OrbState = busy
    ? 'considering'
    : mic.status === 'listening'
      ? playing.current
        ? 'listening-while-speaking'
        : 'listening'
      : 'idle';

  if (loadError) {
    return (
      <main className="grid min-h-screen place-items-center p-6">
        <div className="max-w-md">
          <h1 className="mb-2 text-lg">Anascummis could not start</h1>
          <p className="text-ink-dim">{loadError}</p>
        </div>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="grid min-h-screen place-items-center">
        <p className="text-ink-faint font-mono text-[0.8rem] tracking-wide uppercase">Starting</p>
      </main>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex flex-1 overflow-hidden">
        <main className="flex flex-1 flex-col overflow-hidden">
          <header className="border-hairline flex items-center justify-between border-b px-5 py-3">
            <h1 className="font-mono text-[0.8rem] tracking-wide uppercase">Anascummis</h1>
            <div className="flex items-center gap-3">
              {session.capabilities.model.provider === 'none' && (
                <span className="text-caution font-mono text-[0.68rem] tracking-wide uppercase">
                  No model configured
                </span>
              )}
              <button
                type="button"
                onClick={() => setInspectorOpen((v) => !v)}
                className="text-ink-faint hover:text-ink font-mono text-[0.68rem] tracking-wide uppercase lg:hidden"
              >
                {inspectorOpen ? 'Hide' : 'Details'}
              </button>
            </div>
          </header>

          <div className="flex flex-1 flex-col overflow-y-auto px-5 py-6">
            <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col">
              <div className="mb-8 flex justify-center">
                <Orb state={orbState} level={mic.level} reducedMotion={reducedMotion} />
              </div>

              <Transcript
                turns={turns}
                citations={citations}
                choices={choices}
                busy={busy}
                streamingText={streamingText}
                partialTranscript={mic.partial}
                onChoose={(index) => void send({ text: '', choiceIndex: index })}
              />

              {confirmation && (
                <ConfirmationCard
                  confirmation={confirmation}
                  busy={busy}
                  onConfirm={() =>
                    void send({ text: 'confirmed', token: confirmation.bindingHash })
                  }
                  onCancel={() => {
                    setConfirmation(null);
                    void stop();
                  }}
                />
              )}

              {notice && (
                <div
                  role="status"
                  className="border-hairline text-ink-dim mt-6 border-l-2 pl-4 text-[0.85rem]"
                >
                  <span className="text-ink-faint mr-2 font-mono text-[0.68rem] uppercase">
                    {notice.kind}
                  </span>
                  {notice.message}
                </div>
              )}
            </div>
          </div>

          <Composer
            draft={draft}
            setDraft={setDraft}
            busy={busy}
            micStatus={mic.status}
            micNote={mic.note}
            onSend={() => {
              const text = draft.trim();
              if (!text) return;
              setDraft('');
              void send({ text });
            }}
            onMic={() => void (mic.status === 'listening' ? mic.stop() : mic.start())}
            onStop={() => void stop()}
          />
        </main>

        <div className={`w-80 shrink-0 ${inspectorOpen ? '' : 'hidden lg:block'}`}>
          <Inspector
            tab={tab}
            onTab={setTab}
            jobs={session.jobs}
            capabilities={session.capabilities}
            identity={session.identity}
            memoryEnabled={session.memoryEnabled}
            providers={session.providers}
            onMemoryToggle={(enabled) => {
              void api.setMemoryPersistence(enabled).then(() => {
                setSession((s) => (s ? { ...s, memoryEnabled: enabled } : s));
              });
            }}
            onSignOut={() => void api.logout().then(() => location.reload())}
          />
        </div>
      </div>

      <footer className="border-hairline text-ink-faint flex flex-wrap gap-4 border-t px-5 py-2.5 text-[0.72rem]">
        <button type="button" onClick={() => setPolicy('privacy')} className="hover:text-ink-dim">
          Privacy
        </button>
        <button type="button" onClick={() => setPolicy('terms')} className="hover:text-ink-dim">
          Terms
        </button>
        <button type="button" onClick={() => setPolicy('cookies')} className="hover:text-ink-dim">
          Cookies
        </button>
        <button type="button" onClick={() => setConsentOpen(true)} className="hover:text-ink-dim">
          Cookie settings
        </button>
      </footer>

      <CookieConsent
        consent={session.consent}
        forceOpen={consentOpen}
        onClose={() => setConsentOpen(false)}
        onOpenPolicy={(page) => setPolicy(page)}
        onDecide={async (analytics) => {
          const result = await api.saveConsent(analytics);
          setSession((s) => (s ? { ...s, consent: result.consent } : s));
        }}
      />

      {policy && <Policies page={policy} onClose={() => setPolicy(null)} />}
    </div>
  );
}

/**
 * The confirmation shows the action, the target and what follows. Never an
 * unexplained "Are you sure?".
 */
function ConfirmationCard({
  confirmation,
  busy,
  onConfirm,
  onCancel,
}: {
  confirmation: PendingConfirmation;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <section
      aria-label="Confirmation required"
      className="border-signal-dim bg-ground-raised mt-6 border p-4"
    >
      <h2 className="text-signal mb-1 font-mono text-[0.7rem] tracking-wide uppercase">
        Confirm before this runs
      </h2>
      <p className="mb-1">{confirmation.action}</p>
      <p className="text-ink-dim font-mono text-[0.8rem]">Target: {confirmation.target}</p>
      <ul className="text-ink-dim mt-2 flex flex-col gap-1 text-[0.85rem]">
        {confirmation.consequences.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="border-hairline-bright hover:bg-ground flex-1 border px-3 py-2 text-[0.85rem]"
        >
          No
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className="border-signal text-signal hover:bg-signal/10 flex-1 border px-3 py-2 text-[0.85rem]"
        >
          Yes, run it
        </button>
      </div>
    </section>
  );
}

function Composer({
  draft,
  setDraft,
  busy,
  micStatus,
  micNote,
  onSend,
  onMic,
  onStop,
}: {
  draft: string;
  setDraft: (v: string) => void;
  busy: boolean;
  micStatus: string;
  micNote: string | null;
  onSend: () => void;
  onMic: () => void;
  onStop: () => void;
}) {
  const listening = micStatus === 'listening';
  return (
    <div className="border-hairline border-t px-5 py-3">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-2">
        {micNote && <p className="text-ink-faint text-[0.78rem]">{micNote}</p>}
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={onMic}
            aria-pressed={listening}
            className={`border px-3 py-2 font-mono text-[0.7rem] tracking-wide uppercase transition-colors ${
              listening
                ? 'border-signal text-signal'
                : 'border-hairline text-ink-dim hover:border-hairline-bright'
            }`}
          >
            {listening ? 'Listening' : 'Talk'}
          </button>

          <label className="sr-only" htmlFor="composer">
            Type a message
          </label>
          <textarea
            id="composer"
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            placeholder="Say something, or type it."
            className="border-hairline bg-ground-sunken focus:border-hairline-bright max-h-40 min-h-[2.6rem] flex-1 resize-y border px-3 py-2 outline-none"
          />

          <button
            type="button"
            onClick={onSend}
            disabled={busy || !draft.trim()}
            className="border-hairline text-ink-dim hover:border-hairline-bright border px-3 py-2 font-mono text-[0.7rem] tracking-wide uppercase disabled:opacity-40"
          >
            Send
          </button>

          {/*
            Stop is always present and never depends on the model or the story
            being in a particular state. Escape does the same thing.
          */}
          <button
            type="button"
            onClick={onStop}
            title="Stop (Escape)"
            className="border-caution text-caution hover:bg-caution/10 border px-3 py-2 font-mono text-[0.7rem] tracking-wide uppercase"
          >
            Stop
          </button>
        </div>
      </div>
    </div>
  );
}
