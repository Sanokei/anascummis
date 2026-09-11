import { useEffect, useMemo, useRef } from 'react';
import type { OrbMood, PersonaWear } from '@shared/types';
import {
  drawSphere,
  mix,
  MOODS,
  type MoodParams,
  type Rgb,
  type SphereFrame,
  type SpherePalette,
} from './orb-draw';

/**
 * The sphere.
 *
 * Presence without becoming a second actor. No face, no bouncing, no progress
 * indicator. Speaking motion follows the actual output level; listening is a
 * settled shape with restrained movement; and visible motion stops when the
 * audio does rather than continuing to "talk" on its own.
 *
 * Two things here are deliberate departures from the obvious approach:
 *
 * **The level does not drive everything.** It would be easy to feed it into
 * the radius and let the whole sphere throb, but a shape that changes size with
 * every syllable reads as a VU meter. The radius moves very little; the core
 * brightness and the surface blobs carry the response instead. That reads as
 * *light and surface tension* changing, which is what a living thing does.
 *
 * **Mood and activity are separate axes.** `state` is what the session is
 * doing — the accessibility layer announces it and it must stay honest.
 * `mood` is *manner*, and only a persona sets it. Composing them is what lets
 * the sphere wear a costume without the costume lying about whether it is
 * currently listening.
 */

export type OrbState =
  | 'idle'
  | 'listening'
  | 'speaking'
  | 'listening-while-speaking'
  | 'considering'
  | 'yielding'
  | 'uncertain';

interface OrbProps {
  state: OrbState;
  /** 0..1, the live input level. */
  level: number;
  reducedMotion: boolean;
  size?: number;
  /** The costume, when one is being worn. */
  persona?: PersonaWear | null;
}

const STATE_LABEL: Record<OrbState, string> = {
  idle: 'Idle',
  listening: 'Listening',
  speaking: 'Speaking',
  'listening-while-speaking': 'Speaking, still listening',
  considering: 'Considering a correction',
  yielding: 'Yielding',
  uncertain: 'Uncertain',
};

/**
 * The sphere's own colours.
 *
 * Canvas cannot read CSS custom properties, so this mirrors the tokens in
 * styles.css rather than deriving from them. It is the one place in the client
 * where a colour is written twice, and it is worth it: the sphere's palette is
 * a drawing decision — how much light the shell carries at its rim, how far the
 * core bleeds — and not a theme value someone should be able to swap without
 * re-tuning the gradient stops around it.
 */
const PALETTE: SpherePalette = {
  sphere: { r: 43, g: 196, b: 239 },
  deep: { r: 14, g: 127, b: 180 },
  core: { r: 234, g: 250, b: 255 },
  ground: { r: 250, g: 251, b: 253 },
};

/** How strongly a persona tints the shell. Low on purpose — see `paletteFor`. */
const PERSONA_TINT = 0.22;

/**
 * A persona tints the shell toward its own colour, but only a little.
 *
 * The reference for this is a costume, not a transformation: the creature
 * underneath is recognisably the same one in a hat. A shell that went fully
 * red for the winter persona would read as a different presence arriving, and
 * the product's whole premise is that there is one of these.
 */
function paletteFor(persona: PersonaWear | null | undefined): SpherePalette {
  const shell = persona?.persona.shell;
  if (!shell) return PALETTE;

  const match = /^#?([0-9a-f]{6})$/i.exec(shell.trim());
  if (!match?.[1]) return PALETTE;
  const hex = match[1];
  const target: Rgb = {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
  return {
    ...PALETTE,
    sphere: mix(PALETTE.sphere, target, PERSONA_TINT),
    deep: mix(PALETTE.deep, target, PERSONA_TINT * 0.8),
  };
}

/**
 * How gathered the shell is, per activity state.
 *
 * `considering` pulls in and `speaking` opens out, which is the whole readable
 * vocabulary: gathering is thought, opening is speech. The differences are
 * small because at these sizes a large change reads as a different object
 * rather than the same one moving.
 */
const OPENNESS: Record<OrbState, number> = {
  idle: 0.97,
  listening: 1,
  speaking: 1.04,
  'listening-while-speaking': 1.04,
  considering: 0.93,
  yielding: 0.99,
  uncertain: 1.01,
};

/**
 * How much of the live level reaches the shape, per state.
 *
 * Listening deliberately gets only a quarter of it. The old behaviour fed it
 * nothing at all, which made the sphere look switched off while someone was
 * talking to it; feeding it all of it would make it flinch at every room
 * noise. A quarter reads as attention.
 */
const LEVEL_REACH: Record<OrbState, number> = {
  idle: 0,
  listening: 0.28,
  speaking: 1,
  'listening-while-speaking': 1,
  considering: 0,
  yielding: 0.15,
  uncertain: 0.15,
};

export function Orb({ state, level, reducedMotion, size = 300, persona }: OrbProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const levelRef = useRef(0);
  const timeRef = useRef(0);
  /*
   * The smoothed values live in refs rather than in the effect's closure.
   *
   * State changes often — a turn starts, the microphone opens — and each change
   * tears down and restarts the animation loop. Holding these in the closure
   * would reset them to zero on every transition, so the sphere would visibly
   * snap down and swell back up each time you pressed Talk. They are the
   * sphere's short-term memory and they have to outlive the effect.
   */
  const smoothedLevelRef = useRef(0);
  const smoothedOpenRef = useRef(OPENNESS[state]);
  const lastFrameRef = useRef(0);

  useEffect(() => {
    levelRef.current = level;
  }, [level]);

  const mood: MoodParams = useMemo(() => {
    // A persona arrives over the wire, so its mood is a claim rather than a
    // guarantee. An unrecognised one settles to `even` instead of throwing on
    // a sphere that would then simply not draw.
    const requested = persona?.persona.bits.find((b) => b.id === persona.bitId)?.mood;
    return (requested && MOODS[requested]) || MOODS.even;
  }, [persona]);
  const traits = useMemo(() => persona?.persona.traits ?? [], [persona]);
  const palette = useMemo(() => paletteFor(persona), [persona]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (lastFrameRef.current === 0) lastFrameRef.current = performance.now();

    const draw = (now: number) => {
      // Clamped so a tab that was backgrounded for a minute does not resume by
      // jumping the rotation forward.
      const dt = Math.min((now - lastFrameRef.current) / 1000, 1 / 20);
      lastFrameRef.current = now;

      const targetLevel = levelRef.current * LEVEL_REACH[state];
      // Asymmetric smoothing: rises quickly, falls slowly. Speech that snaps
      // back to rest between words looks like a broken indicator light.
      const rate = targetLevel > smoothedLevelRef.current ? 0.28 : 0.09;
      smoothedLevelRef.current += (targetLevel - smoothedLevelRef.current) * rate;
      smoothedOpenRef.current += (OPENNESS[state] - smoothedOpenRef.current) * 0.06;

      if (!reducedMotion) timeRef.current += dt * mood.motion;

      const frame: SphereFrame = {
        size,
        time: timeRef.current,
        level: smoothedLevelRef.current,
        openness: smoothedOpenRef.current,
        mood,
        palette,
        traits,
        still: reducedMotion,
      };

      drawSphere(ctx, frame);
      frameRef.current = requestAnimationFrame(draw);
    };

    frameRef.current = requestAnimationFrame(draw);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [size, state, reducedMotion, mood, traits, palette]);

  const announced = persona ? `${STATE_LABEL[state]}, wearing ${persona.persona.name}` : STATE_LABEL[state];

  return (
    <div
      className={`relative grid place-items-center ${
        state === 'listening' && !reducedMotion ? 'orb-listening' : ''
      }`}
      style={{ width: size, height: size }}
    >
      {/* The sphere is decorative; the state is announced in text below. */}
      <canvas ref={canvasRef} style={{ width: size, height: size }} aria-hidden="true" />
      <span role="status" aria-live="polite" className="sr-only">
        {announced}
      </span>
    </div>
  );
}
