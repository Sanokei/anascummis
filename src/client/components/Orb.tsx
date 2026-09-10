import { useEffect, useRef } from 'react';

/**
 * The orb.
 *
 * Presence without becoming a second actor. No face, no bouncing, no progress
 * indicator. Speaking motion follows the actual output level; listening is a
 * settled shape with very restrained movement; and visible motion stops when
 * the audio does rather than continuing to "talk" on its own.
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
  /** 0..1, the live level driving speaking motion. */
  level: number;
  reducedMotion: boolean;
  size?: number;
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

export function Orb({ state, level, reducedMotion, size = 168 }: OrbProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const levelRef = useRef(0);
  const phaseRef = useRef(0);

  useEffect(() => {
    levelRef.current = level;
  }, [level]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    let smoothed = 0;

    const draw = () => {
      const centre = size / 2;
      const base = size * 0.29;

      // Smooth the level so the shape breathes rather than flickering.
      const target = state === 'speaking' || state === 'listening-while-speaking' ? levelRef.current : 0;
      smoothed += (target - smoothed) * 0.18;

      phaseRef.current += reducedMotion ? 0 : 0.012;
      const phase = phaseRef.current;

      ctx.clearRect(0, 0, size, size);

      // Considering gathers slightly; uncertain sits asymmetrically.
      const gather = state === 'considering' ? 0.94 : 1;
      const skewX = state === 'uncertain' ? 1.06 : 1;
      const skewY = state === 'uncertain' ? 0.95 : 1;

      const amplitude = smoothed * size * 0.075;
      const drift = reducedMotion ? 0 : Math.sin(phase) * size * 0.006;

      ctx.save();
      ctx.translate(centre, centre);
      ctx.scale(skewX, skewY);

      // Three nested rings. The outer one carries the motion, so the core
      // stays legible and the whole thing never reads as a pulse animation.
      const rings = [
        { r: base * gather + amplitude + drift, alpha: 0.14, width: 1 },
        { r: base * 0.74 * gather + amplitude * 0.55, alpha: 0.3, width: 1 },
        { r: base * 0.42 * gather + amplitude * 0.25, alpha: 0.85, width: 1.5 },
      ];

      for (const ring of rings) {
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(2, ring.r), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(201, 138, 60, ${ring.alpha})`;
        ctx.lineWidth = ring.width;
        ctx.stroke();
      }

      // A solid core, dimmed when idle and steady when listening.
      const coreAlpha = state === 'idle' ? 0.28 : state === 'yielding' ? 0.4 : 0.72;
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(2, base * 0.18 * gather), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(236, 232, 223, ${coreAlpha})`;
      ctx.fill();

      // While speaking and still listening, one small acknowledgement mark
      // rather than switching attention off.
      if (state === 'listening-while-speaking') {
        ctx.beginPath();
        ctx.arc(base * 0.98, 0, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(111, 143, 92, 0.9)';
        ctx.fill();
      }

      ctx.restore();
      frameRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [size, state, reducedMotion]);

  return (
    <div
      className={`relative grid place-items-center ${
        state === 'listening' && !reducedMotion ? 'orb-listening' : ''
      }`}
      style={{ width: size, height: size }}
    >
      <canvas ref={canvasRef} style={{ width: size, height: size }} aria-hidden="true" />
      {/* The state is announced in text, because the shape alone is not accessible. */}
      <span role="status" aria-live="polite" className="sr-only">
        {STATE_LABEL[state]}
      </span>
    </div>
  );
}
