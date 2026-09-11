import { useEffect, useMemo, useRef, useState } from 'react';
import type { OrbMood, Persona, PersonaWear, SurfaceWindow, Turn } from '@shared/types';
import { AUTHORED_PERSONAS } from '../worker/personas/authored';
import { Orb, type OrbState } from '../client/components/Orb';
import { SurfaceLayer } from '../client/components/SurfaceLayer';
import { Transcript } from '../client/components/Transcript';
import { SCENARIOS } from './scenarios';

/**
 * The design preview.
 *
 * This exists because the real thing will not run without wrangler, D1, a
 * Durable Object and model keys, and a redesign nobody can look at is not a
 * redesign. So it mounts the *actual* components — the same `Orb`, the same
 * `SurfaceLayer`, the same personas the worker validates against, and the same
 * compiled stylesheet — against static data, and adds one control strip.
 *
 * The control strip is deliberately quarantined below a rule and says out loud
 * that it is not part of the interface. A preview that quietly mixes its own
 * scaffolding in with the design is how a person ends up approving a control
 * that does not exist.
 */

const STATES: OrbState[] = [
  'idle',
  'listening',
  'speaking',
  'listening-while-speaking',
  'considering',
  'yielding',
  'uncertain',
];

const MOODS: OrbMood[] = ['even', 'bright', 'deadpan', 'mischief', 'grave', 'tender'];

const TURNS: Turn[] = [
  {
    id: 't1',
    role: 'user',
    text: 'Friday train or drive?',
    at: '2026-09-10T09:00:00.000Z',
  },
  {
    id: 't2',
    role: 'assistant',
    text: 'Take the train. The 16:03 gets in at 18:40 for £41, and the drive is four hours before you count the roadworks at junction 19 — which have added twenty minutes every weekday this month.\n\nDriving is cheaper on fuel alone. It stops being cheaper once you park for two days.',
    at: '2026-09-10T09:00:01.000Z',
  },
];

/**
 * A synthetic input level.
 *
 * Speech is not a sine wave. It is bursts with gaps in them, which is why a
 * sphere driven by a smooth oscillation looks like a loading bar and one driven
 * by this looks like something talking. Listening is a much smaller, slower
 * movement — attention rather than volume.
 */
function useSimulatedLevel(state: OrbState, reducedMotion: boolean): number {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (reducedMotion || (state !== 'speaking' && state !== 'listening-while-speaking' && state !== 'listening')) {
      setLevel(0);
      return;
    }
    let frame = 0;
    let t = 0;
    const tick = () => {
      t += 1 / 60;
      const syllable = Math.max(0, Math.sin(t * 11.3)) * Math.max(0, Math.sin(t * 3.1));
      const phrase = Math.max(0, Math.sin(t * 1.35) - 0.15) / 0.85;
      const gap = Math.sin(t * 0.42) > 0.72 ? 0.08 : 1;
      const raw = syllable * phrase * gap;
      const shaped = state === 'listening' ? 0.1 + raw * 0.14 : 0.12 + raw * 0.85;
      setLevel(Math.min(1, shaped));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [state, reducedMotion]);

  return level;
}

export function PreviewApp() {
  const [state, setState] = useState<OrbState>('speaking');
  const [mood, setMood] = useState<OrbMood>('even');
  const [personaId, setPersonaId] = useState<string | null>('midwinter');
  /*
   * Opens on one window, not on the pile.
   *
   * The first frame is the one a person actually sees — before they have
   * clicked anything, and in a screenshot or a shared link. Twelve overlapping
   * windows is the most impressive *fact* about the layer and the worst possible
   * thing to open with, because it hides the sphere and the conversation behind
   * a stack of chrome. The ladder to twelve is one click away and says so.
   */
  const [scenarioId, setScenarioId] = useState('one');
  const [reducedMotion, setReducedMotion] = useState(false);
  const [windows, setWindows] = useState<SurfaceWindow[]>(
    () => SCENARIOS.find((s) => s.id === 'one')?.windows ?? [],
  );

  const level = useSimulatedLevel(state, reducedMotion);
  const scenario = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0]!;

  /*
   * Which persona is worn, and which of its bits is running.
   *
   * The bit matters to the sphere: mood comes from the bit, not the persona, so
   * the same costume can be wry in one beat and grave in the next. Taking the
   * first bit is what the worker does for a wear with no bit named, so the
   * preview matches.
   */
  const persona = useMemo<Persona | null>(
    () => AUTHORED_PERSONAS.find((p) => p.id === personaId) ?? null,
    [personaId],
  );

  const wear = useMemo<PersonaWear | null>(() => {
    if (!persona) return null;
    const bit = persona.bits[0] ?? null;
    return {
      persona,
      bitId: bit?.id ?? null,
      expiresAt: new Date(Date.now() + persona.maxDurationMs).toISOString(),
      reason: 'preview',
    };
  }, [persona]);

  // The mood the sphere actually renders. A costume's bit sets it; the manual
  // control only applies when no costume is on, which is how it works in the
  // product — a persona is the thing allowed to change manner.
  const effectiveMood: OrbMood = wear?.persona.bits.find((b) => b.id === wear.bitId)?.mood ?? mood;

  const applyScenario = (id: string) => {
    setScenarioId(id);
    setWindows(SCENARIOS.find((s) => s.id === id)?.windows ?? []);
  };

  const speak = () => {
    setState('considering');
    window.setTimeout(() => setState('speaking'), 620);
    window.setTimeout(() => setState('idle'), 4200);
  };

  return (
    /*
     * The bottom padding is the mobile sheet stack. Below 640px the sheets are
     * a fixed overlay, so without this they sit on top of the control strip and
     * the last thing the assistant said, and neither can be scrolled clear.
     */
    <div className="min-h-dvh pb-[var(--surface-sheet-height)]">
      <SurfaceLayer
        windows={windows}
        onDismiss={(id) => setWindows((open) => open.filter((w) => w.id !== id))}
        reducedMotion={reducedMotion}
      />

      <header className="border-hairline bg-ground/85 sticky top-0 z-20 border-b backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-3">
          <span className="text-[0.95rem]">Anascummis</span>
          <span className="text-ink-faint font-mono text-[0.72rem]">
            design preview{wear ? ` · wearing ${wear.persona.name}` : ''}
          </span>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-col items-center gap-8 px-4 pt-8 pb-16">
        <Orb
          state={state}
          level={level}
          reducedMotion={reducedMotion}
          size={300}
          persona={wear}
        />

        <div className="w-full">
          <Transcript
            turns={TURNS}
            citations={[]}
            choices={[]}
            busy={false}
            streamingText={null}
            partialTranscript={null}
            onChoose={() => {}}
          />
        </div>
      </main>

      {/*
        Below the rule: scaffolding. It is styled as a strip rather than as part
        of the page, and it labels itself, so nobody mistakes a preview lever for
        a shipped control.
      */}
      <section
        aria-label="Preview controls"
        className="border-hairline bg-ground-sunken/70 border-t"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6">
          <p className="text-ink-faint text-[0.8rem]">
            These controls drive the preview. They are not part of the interface.
          </p>

          <Field label="State">
            <div className="flex flex-wrap gap-1.5">
              {STATES.map((s) => (
                <Chip key={s} active={state === s} onClick={() => setState(s)}>
                  {s}
                </Chip>
              ))}
              <Chip active={false} onClick={speak}>
                simulate a reply
              </Chip>
            </div>
          </Field>

          <Field label="Costume">
            <div className="flex flex-wrap gap-1.5">
              <Chip active={personaId === null} onClick={() => setPersonaId(null)}>
                none
              </Chip>
              {AUTHORED_PERSONAS.map((p) => (
                <Chip
                  key={p.id}
                  active={personaId === p.id}
                  onClick={() => setPersonaId(p.id)}
                  title={p.occasion}
                >
                  {p.name}
                </Chip>
              ))}
            </div>
          </Field>

          <Field label="Mood" hint={wear ? 'set by the costume while one is worn' : undefined}>
            <div className="flex flex-wrap gap-1.5">
              {MOODS.map((m) => (
                <Chip
                  key={m}
                  active={effectiveMood === m}
                  disabled={wear !== null}
                  onClick={() => setMood(m)}
                >
                  {m}
                </Chip>
              ))}
            </div>
          </Field>

          <Field label="Surfaces">
            <div className="flex flex-wrap gap-1.5">
              {SCENARIOS.map((s) => (
                <Chip key={s.id} active={scenarioId === s.id} onClick={() => applyScenario(s.id)}>
                  {s.label}
                </Chip>
              ))}
            </div>
            <p className="text-ink-dim mt-2 text-[0.82rem]">{scenario.note}</p>
          </Field>

          <Field label="Accessibility">
            <div className="flex flex-wrap gap-1.5">
              <Chip active={reducedMotion} onClick={() => setReducedMotion((v) => !v)}>
                reduced motion
              </Chip>
            </div>
          </Field>
        </div>
      </section>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <h2 className="text-ink-faint text-[0.78rem]">{label}</h2>
        {hint && <span className="text-ink-faint font-mono text-[0.68rem]">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Chip({
  active,
  disabled,
  title,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      className={`border-hairline rounded-block focus-visible:outline-signal border px-2.5 py-1 font-mono text-[0.72rem] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40 ${
        active
          ? 'border-signal bg-ground-raised text-signal'
          : 'bg-ground-raised text-ink-dim hover:border-hairline-bright'
      }`}
    >
      {children}
    </button>
  );
}
