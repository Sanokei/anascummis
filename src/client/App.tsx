import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Citation,
  InkChoiceView,
  PendingConfirmation,
  PersonaWear,
  SurfaceWindow,
  Turn,
  TurnSurfaces,
} from '@shared/types';
import { MAX_OPEN_SURFACES } from '@shared/types';
import { api, ApiFailure, type SessionState } from './api';
import { Orb, type OrbState } from './components/Orb';
import { Transcript } from './components/Transcript';
import { SurfaceLayer } from './components/SurfaceLayer';
import { Inspector, type InspectorTab } from './components/Inspector';
import { CookieConsent } from './components/CookieConsent';
import { Policies, type PolicyPage } from './pages/Policies';
import { useMic } from './hooks/useMic';

/**
 * Windows survive a reload.
 *
 * They live in session storage rather than on the server because they are
 * *view* state: the assistant's turns are the record, and what is currently
 * arranged on screen is not part of it. Keeping them here means a refresh
 * mid-task does not scatter everything the assistant had put in front of you,
 * without inventing a server-side window model that would then have to be
 * reconciled against what the person had dragged where.
 *
 * Every access is guarded. Private-mode browsers and blocked site data both
 * make storage throw rather than return nothing, and losing your windows is a
 * far smaller failure than failing to start.
 */
const SURFACE_STORAGE_KEY = 'anascummis.windows';

function loadStoredWindows(): SurfaceWindow[] {
  try {
    const raw = sessionStorage.getItem(SURFACE_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SurfaceWindow[]).slice(0, MAX_OPEN_SURFACES) : [];
  } catch {
    return [];
  }
}

function storeWindows(windows: SurfaceWindow[]): void {
  try {
    sessionStorage.setItem(SURFACE_STORAGE_KEY, JSON.stringify(windows));
  } catch {
    /* Nothing to do about it, and nothing worth telling the person. */
  }
}

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
  const [windows, setWindows] = useState<SurfaceWindow[]>(loadStoredWindows);
  const [persona, setPersona] = useState<PersonaWear | null>(null);

  const turnAbort = useRef<AbortController | null>(null);
  const playing = useRef(false);

  const reducedMotion = session?.config.accessibility.reducedMotion ?? false;
  const orbSize = useOrbSize();

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

  useEffect(() => {
    storeWindows(windows);
  }, [windows]);

  // Accessibility preferences apply at the root, so everything inherits them.
  useEffect(() => {
    if (!session) return;
    const root = document.documentElement;
    root.dataset.textScale = String(session.config.accessibility.textScale);
    root.style.setProperty('--text-scale', String(session.config.accessibility.textScale));
    root.dataset.contrast = session.config.accessibility.highContrast ? 'high' : 'normal';
    root.dataset.motion = session.config.accessibility.reducedMotion ? 'reduced' : 'full';
  }, [session]);

  /* ---------------- surfaces ---------------- */

  /**
   * Applies what a turn wants shown.
   *
   * A window is upserted by id rather than appended, which is the whole reason
   * surfaces carry stable ids: two turns about the same comparison should
   * update one window, not raise a second one beside it. Closing is applied
   * after opening, so a turn can replace a window and its successor in one go
   * without the ids ever colliding.
   */
  const applySurfaces = useCallback((surfaces: TurnSurfaces | undefined) => {
    if (!surfaces) return;
    setPersona(surfaces.persona);

    const plan = surfaces.plan;
    if (!plan) return;

    setWindows((current) => {
      const next = new Map(current.map((w) => [w.id, w]));
      for (const window of plan.windows) {
        const existing = next.get(window.id);
        // Merging rather than replacing keeps the arrival time of a window
        // that is only being updated, so it does not jump to the front of the
        // cascade every time its contents change.
        next.set(window.id, existing ? { ...window, createdAt: existing.createdAt } : window);
      }
      for (const closed of plan.close) next.delete(closed.id);
      // Insertion order is the raise order, so the oldest window is dropped
      // rather than whichever one happens to be least interesting.
      return [...next.values()].slice(-MAX_OPEN_SURFACES);
    });
  }, []);

  /*
   * A costume comes off on its own.
   *
   * The server also expires it, but only when the next turn happens — and a
   * joke that is still on the sphere's face ten minutes later because nobody
   * has said anything since is exactly the failure the expiry exists to stop.
   */
  useEffect(() => {
    if (!persona) return;
    const remaining = Date.parse(persona.expiresAt) - Date.now();
    if (remaining <= 0) {
      setPersona(null);
      return;
    }
    const timer = window.setTimeout(() => setPersona(null), remaining);
    return () => window.clearTimeout(timer);
  }, [persona]);

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
        applySurfaces(response.surfaces);
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
    [applySurfaces],
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
        <p className="text-ink-faint font-mono text-[0.8rem]">Starting</p>
      </main>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="border-hairline flex shrink-0 items-center justify-between border-b px-6 py-3">
        <div className="flex items-baseline gap-4">
          <h1 className="text-[0.95rem] font-medium tracking-[-0.01em]">Anascummis</h1>
          {persona && (
            <p className="text-ink-faint text-[0.82rem]">
              wearing <span className="text-ink-dim">{persona.persona.name}</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-4">
          {session.capabilities.model.provider === 'none' && (
            <span className="text-caution font-mono text-[0.72rem]">No model configured</span>
          )}
          <button
            type="button"
            onClick={() => setInspectorOpen((v) => !v)}
            className="text-ink-faint hover:text-ink text-[0.8rem] lg:hidden"
          >
            {inspectorOpen ? 'Hide details' : 'Details'}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
          {/*
            The sphere holds the top of the page and never scrolls away. A
            presence that leaves when the conversation gets long is not a
            presence; it is a header image.
          */}
          <div className="grid shrink-0 place-items-center pt-3 pb-1">
            <Orb
              state={orbState}
              level={mic.level}
              reducedMotion={reducedMotion}
              size={orbSize}
              persona={persona}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6">
            <div className="mx-auto w-full max-w-2xl pb-6">
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
                  onConfirm={() => void send({ text: 'confirmed', token: confirmation.bindingHash })}
                  onCancel={() => {
                    setConfirmation(null);
                    void stop();
                  }}
                />
              )}

              {notice && (
                <div
                  role="status"
                  className="border-caution/40 text-ink-dim mt-6 border-l-2 pl-4 text-[0.88rem]"
                >
                  <span className="text-caution mr-2 font-mono text-[0.72rem]">{notice.kind}</span>
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

      <footer className="border-hairline text-ink-faint flex shrink-0 flex-wrap gap-5 border-t px-6 py-2.5 text-[0.76rem]">
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

      {/*
        Above the page, below nothing. Windows are what the assistant put in
        front of you, and they belong over the conversation rather than beside
        it.
      */}
      <SurfaceLayer
        windows={windows}
        onDismiss={(id) => setWindows((current) => current.filter((w) => w.id !== id))}
        reducedMotion={reducedMotion}
      />

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
 * The sphere's size, from the viewport.
 *
 * Driven by the smaller axis so it stays a circle the page has room for —
 * on a short window it is the height that runs out first. The floor matters
 * more than the ceiling: below about 150px the lattice stops resolving and it
 * becomes a blue dot.
 */
function useOrbSize(): number {
  const [size, setSize] = useState(() => orbSizeFor(window.innerWidth, window.innerHeight));
  useEffect(() => {
    const onResize = () => setSize(orbSizeFor(window.innerWidth, window.innerHeight));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}

function orbSizeFor(width: number, height: number): number {
  return Math.max(150, Math.round(Math.min(width * 0.34, height * 0.36, 320)));
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
      className="border-caution/45 bg-ground-raised mt-6 rounded-[var(--radius-block)] border p-4"
    >
      <h2 className="text-caution mb-1.5 text-[0.82rem]">Confirm before this runs</h2>
      <p className="mb-1">{confirmation.action}</p>
      <p className="text-ink-dim font-mono text-[0.82rem]">Target: {confirmation.target}</p>
      <ul className="text-ink-dim mt-2 flex flex-col gap-1 text-[0.88rem]">
        {confirmation.consequences.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="border-hairline hover:bg-ground-sunken flex-1 rounded-[var(--radius-block)] border px-3 py-2 text-[0.88rem] transition-colors"
        >
          No
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className="border-caution text-caution hover:bg-caution/10 flex-1 rounded-[var(--radius-block)] border px-3 py-2 text-[0.88rem] transition-colors"
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
    <div className="shrink-0 px-6 pt-2 pb-5">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-2">
        {micNote && <p className="text-ink-faint text-[0.8rem]">{micNote}</p>}
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={onMic}
            aria-pressed={listening}
            className={`shrink-0 rounded-full border px-4 py-2.5 text-[0.85rem] transition-colors ${
              listening
                ? 'border-signal text-signal bg-signal/10'
                : 'border-hairline text-ink-dim hover:border-hairline-bright hover:text-ink'
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
            className="border-hairline bg-ground-raised focus:border-signal max-h-40 min-h-[2.9rem] min-w-0 flex-1 resize-y rounded-[var(--radius-panel)] border px-3.5 py-2.5 outline-none transition-colors placeholder:text-ink-faint"
          />

          <button
            type="button"
            onClick={onSend}
            disabled={busy || !draft.trim()}
            className="border-hairline text-ink-dim hover:border-hairline-bright hover:text-ink shrink-0 rounded-full border px-4 py-2.5 text-[0.85rem] transition-colors disabled:opacity-40"
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
            className="border-caution/50 text-caution hover:bg-caution/10 shrink-0 rounded-full border px-4 py-2.5 text-[0.85rem] transition-colors"
          >
            Stop
          </button>
        </div>
      </div>
    </div>
  );
}
