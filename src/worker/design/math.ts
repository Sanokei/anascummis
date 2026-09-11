/**
 * The arithmetic the design harness measures with.
 *
 * Deliberately tiny and dependency-free: these routines run over authored
 * source and rendered pixels inside the Worker, and every one of them has to be
 * testable without a browser, a canvas, or a model. Where a value is unknown
 * the convention is `null` rather than zero, so "nothing here" can never be
 * mistaken for "here is a thing at the origin".
 */

import type { Bounds, Bounds2D, Vec2, Vec3 } from './types';

/** A 4x4 matrix in column-major order, matching glTF's convention. */
export type Mat4 = Float64Array;

export const vec3 = (x: number, y: number, z: number): Vec3 => [x, y, z];
export const vec2 = (x: number, y: number): Vec2 => [x, y];

export function add3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale3(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function mul3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
}

export function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross3(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function length3(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

/** Returns null for a zero-length vector rather than a vector of NaNs. */
export function normalize3(a: Vec3): Vec3 | null {
  const len = length3(a);
  if (len === 0 || !Number.isFinite(len)) return null;
  return [a[0] / len, a[1] / len, a[2] / len];
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Approximate equality, used where float arithmetic has accumulated error. */
export function nearly(a: number, b: number, epsilon = 1e-9): boolean {
  return Math.abs(a - b) <= epsilon;
}

/* ------------------------------------------------------------------ */
/* Matrices                                                            */
/* ------------------------------------------------------------------ */

export function identity4(): Mat4 {
  const m = new Float64Array(16);
  m[0] = 1;
  m[5] = 1;
  m[10] = 1;
  m[15] = 1;
  return m;
}

/** `a * b`, both column-major, so the result applies `b` first. */
export function multiply4(a: Mat4, b: Mat4): Mat4 {
  const out = new Float64Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += (a[k * 4 + row] ?? 0) * (b[col * 4 + k] ?? 0);
      }
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

export function translation4(t: Vec3): Mat4 {
  const m = identity4();
  m[12] = t[0];
  m[13] = t[1];
  m[14] = t[2];
  return m;
}

export function scale4(s: Vec3): Mat4 {
  const m = new Float64Array(16);
  m[0] = s[0];
  m[5] = s[1];
  m[10] = s[2];
  m[15] = 1;
  return m;
}

export function rotationX4(degrees: number): Mat4 {
  const r = (degrees * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const m = identity4();
  m[5] = c;
  m[6] = s;
  m[9] = -s;
  m[10] = c;
  return m;
}

export function rotationY4(degrees: number): Mat4 {
  const r = (degrees * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const m = identity4();
  m[0] = c;
  m[2] = -s;
  m[8] = s;
  m[10] = c;
  return m;
}

export function rotationZ4(degrees: number): Mat4 {
  const r = (degrees * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const m = identity4();
  m[0] = c;
  m[1] = s;
  m[4] = -s;
  m[5] = c;
  return m;
}

/** Apply X, then Y, then Z — the order a reader of `rotation=(x,y,z)` expects. */
export function rotationXYZ4(degrees: Vec3): Mat4 {
  return multiply4(multiply4(rotationZ4(degrees[2]), rotationY4(degrees[1])), rotationX4(degrees[0]));
}

export function compose4(position: Vec3, rotation: Vec3, scale: Vec3): Mat4 {
  return multiply4(
    multiply4(translation4(position), rotationXYZ4(rotation)),
    scale4(scale),
  );
}

export function transformPoint4(m: Mat4, p: Vec3): Vec3 {
  const x = p[0];
  const y = p[1];
  const z = p[2];
  return [
    (m[0] ?? 0) * x + (m[4] ?? 0) * y + (m[8] ?? 0) * z + (m[12] ?? 0),
    (m[1] ?? 0) * x + (m[5] ?? 0) * y + (m[9] ?? 0) * z + (m[13] ?? 0),
    (m[2] ?? 0) * x + (m[6] ?? 0) * y + (m[10] ?? 0) * z + (m[14] ?? 0),
  ];
}

/** Direction transform: ignores translation, because a direction has no place. */
export function transformDirection4(m: Mat4, d: Vec3): Vec3 {
  const x = d[0];
  const y = d[1];
  const z = d[2];
  return [
    (m[0] ?? 0) * x + (m[4] ?? 0) * y + (m[8] ?? 0) * z,
    (m[1] ?? 0) * x + (m[5] ?? 0) * y + (m[9] ?? 0) * z,
    (m[2] ?? 0) * x + (m[6] ?? 0) * y + (m[10] ?? 0) * z,
  ];
}

/* ------------------------------------------------------------------ */
/* Bounds                                                              */
/* ------------------------------------------------------------------ */

export const EMPTY_BOUNDS: Bounds = {
  min: [Infinity, Infinity, Infinity],
  max: [-Infinity, -Infinity, -Infinity],
};

export function boundsFromPoints(points: Vec3[]): Bounds | null {
  if (points.length === 0) return null;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let i = 0; i < 3; i++) {
      const v = p[i] ?? 0;
      if (v < (min[i] ?? Infinity)) min[i] = v;
      if (v > (max[i] ?? -Infinity)) max[i] = v;
    }
  }
  return { min, max };
}

export function unionBounds(a: Bounds | null, b: Bounds | null): Bounds | null {
  if (!a) return b;
  if (!b) return a;
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  };
}

export function boundsSize(b: Bounds): Vec3 {
  return [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
}

export function boundsCenter(b: Bounds): Vec3 {
  return [
    (b.min[0] + b.max[0]) / 2,
    (b.min[1] + b.max[1]) / 2,
    (b.min[2] + b.max[2]) / 2,
  ];
}

export function boundsVolume(b: Bounds): number {
  const s = boundsSize(b);
  return Math.max(0, s[0]) * Math.max(0, s[1]) * Math.max(0, s[2]);
}

/**
 * Overlap volume rather than a boolean, because "these two parts intersect" is
 * far less useful to a reviewer than "by how much".
 */
export function intersectionVolume(a: Bounds, b: Bounds): number {
  const dx = Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]);
  const dy = Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]);
  const dz = Math.min(a.max[2], b.max[2]) - Math.max(a.min[2], b.min[2]);
  if (dx <= 0 || dy <= 0 || dz <= 0) return 0;
  return dx * dy * dz;
}

/**
 * A small tolerance, so parts that merely touch are not reported as
 * interpenetrating. Without it, a lamp post standing exactly on its base would
 * be flagged as overlapping it.
 */
export function overlaps(a: Bounds, b: Bounds, tolerance = 1e-6): boolean {
  return intersectionVolume(a, b) > tolerance;
}

export function boundsFromPoints2D(points: Vec2[]): Bounds2D | null {
  if (points.length === 0) return null;
  const min: Vec2 = [Infinity, Infinity];
  const max: Vec2 = [-Infinity, -Infinity];
  for (const p of points) {
    min[0] = Math.min(min[0], p[0]);
    min[1] = Math.min(min[1], p[1]);
    max[0] = Math.max(max[0], p[0]);
    max[1] = Math.max(max[1], p[1]);
  }
  return { min, max };
}

export function toBounds2D(b: Bounds): Bounds2D {
  return { min: [b.min[0], b.min[1]], max: [b.max[0], b.max[1]] };
}

export function unionBounds2D(a: Bounds2D | null, b: Bounds2D | null): Bounds2D | null {
  if (!a) return b;
  if (!b) return a;
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1])],
  };
}

export function bounds2DContains(outer: Bounds2D, inner: Bounds2D, tolerance = 1e-6): boolean {
  return (
    inner.min[0] >= outer.min[0] - tolerance &&
    inner.min[1] >= outer.min[1] - tolerance &&
    inner.max[0] <= outer.max[0] + tolerance &&
    inner.max[1] <= outer.max[1] + tolerance
  );
}

export function bounds2DOverlapArea(a: Bounds2D, b: Bounds2D): number {
  const dx = Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]);
  const dy = Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]);
  if (dx <= 0 || dy <= 0) return 0;
  return dx * dy;
}

/* ------------------------------------------------------------------ */
/* Colour                                                              */
/* ------------------------------------------------------------------ */

/**
 * CSS named colours that appear in practice. Named colours are resolved so a
 * palette claim can be checked against what was actually written; an unknown
 * name resolves to null and is reported rather than guessed at.
 */
export const NAMED_COLORS: Record<string, string> = {
  black: '#000000',
  silver: '#c0c0c0',
  gray: '#808080',
  grey: '#808080',
  white: '#ffffff',
  maroon: '#800000',
  red: '#ff0000',
  purple: '#800080',
  fuchsia: '#ff00ff',
  magenta: '#ff00ff',
  green: '#008000',
  lime: '#00ff00',
  olive: '#808000',
  yellow: '#ffff00',
  navy: '#000080',
  blue: '#0000ff',
  teal: '#008080',
  aqua: '#00ffff',
  cyan: '#00ffff',
  orange: '#ffa500',
  gold: '#ffd700',
  pink: '#ffc0cb',
  brown: '#a52a2a',
  beige: '#f5f5dc',
  ivory: '#fffff0',
  khaki: '#f0e68c',
  indigo: '#4b0082',
  violet: '#ee82ee',
  salmon: '#fa8072',
  tomato: '#ff6347',
  crimson: '#dc143c',
  turquoise: '#40e0d0',
};

/**
 * Normalises a colour to `#rrggbb`, lower-case.
 *
 * Accepts `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` (alpha dropped, because a
 * palette claim is about hue), `rgb()`/`rgba()`, and CSS colour names.
 * Returns null for anything else — including `url(...)`, which is a paint
 * server and not a colour — so callers report it instead of inventing one.
 */
export function normaliseColor(input: string): string | null {
  const value = input.trim().toLowerCase();
  if (!value || value === 'none' || value === 'transparent' || value === 'currentcolor') {
    return null;
  }
  if (value.startsWith('#')) {
    const hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const r = hex[0];
      const g = hex[1];
      const b = hex[2];
      if (!r || !g || !b) return null;
      if (!/^[0-9a-f]{3,4}$/.test(hex)) return null;
      return `#${r}${r}${g}${g}${b}${b}`;
    }
    if (hex.length === 6 || hex.length === 8) {
      if (!/^[0-9a-f]{6,8}$/.test(hex)) return null;
      return `#${hex.slice(0, 6)}`;
    }
    return null;
  }
  const functional = /^rgba?\(([^)]+)\)$/.exec(value);
  if (functional?.[1]) {
    const parts = functional[1]
      .split(/[\s,/]+/)
      .map((p) => p.trim())
      .filter(Boolean)
      .slice(0, 3);
    if (parts.length < 3) return null;
    const channels = parts.map((p) => {
      if (p.endsWith('%')) {
        const n = Number.parseFloat(p.slice(0, -1));
        return Number.isFinite(n) ? Math.round((n / 100) * 255) : null;
      }
      const n = Number.parseFloat(p);
      return Number.isFinite(n) ? Math.round(clamp(n, 0, 255)) : null;
    });
    if (channels.some((c) => c === null)) return null;
    return `#${channels.map((c) => (c ?? 0).toString(16).padStart(2, '0')).join('')}`;
  }
  return NAMED_COLORS[value] ?? null;
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const normalised = normaliseColor(hex);
  if (!normalised) return null;
  return [
    Number.parseInt(normalised.slice(1, 3), 16),
    Number.parseInt(normalised.slice(3, 5), 16),
    Number.parseInt(normalised.slice(5, 7), 16),
  ];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clampChannel = (v: number) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${clampChannel(r)}${clampChannel(g)}${clampChannel(b)}`;
}

/** WCAG relative luminance. */
export function relativeLuminance(r: number, g: number, b: number): number {
  const channel = (value: number) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio, 1..21. Symmetric in its arguments. */
export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const la = relativeLuminance(a[0], a[1], a[2]);
  const lb = relativeLuminance(b[0], b[1], b[2]);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/* ------------------------------------------------------------------ */
/* Parsing helpers shared by the two source languages                  */
/* ------------------------------------------------------------------ */

/** A number, or null. Rejects `NaN`, `Infinity`, and trailing junk. */
export function parseNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(trimmed)) return null;
  const n = Number.parseFloat(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * A number plus an optional CSS unit. Returns the number in user units; the
 * unit is returned so a caller can decide whether to trust it. Percentages come
 * back as `null` because resolving one needs the viewport, which the caller has
 * and this function does not.
 */
export function parseLength(value: string): { value: number; unit: string } | null {
  const match = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([a-z%]*)\s*$/i.exec(value);
  if (!match?.[1]) return null;
  const n = Number.parseFloat(match[1]);
  if (!Number.isFinite(n)) return null;
  const unit = (match[2] ?? '').toLowerCase();
  if (unit === '%') return null;
  return { value: n, unit };
}

/** Comma or whitespace separated numbers, as SVG and the scene language write them. */
export function parseNumberList(value: string): number[] | null {
  const parts = value
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
  const out: number[] = [];
  for (const part of parts) {
    const n = parseNumber(part);
    if (n === null) return null;
    out.push(n);
  }
  return out;
}

export function parseVec3(value: string): Vec3 | null {
  const numbers = parseNumberList(value);
  if (!numbers || numbers.length !== 3) return null;
  return [numbers[0] ?? 0, numbers[1] ?? 0, numbers[2] ?? 0];
}
