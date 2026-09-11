import type { OrbMood, PersonaTrait } from '@shared/types';

/**
 * The sphere, drawn.
 *
 * This is the one place in the interface where colour and motion are spent, so
 * it is worth saying what it is made of and why each part is there.
 *
 * The shape is built in four layers, back to front:
 *
 *   1. **The glow** — a wide, soft radial wash. It is what makes the sphere
 *      read as emitting rather than reflecting, and it is the reason the sphere
 *      has room around it.
 *   2. **The shell** — a translucent fill that is *dimmer in the middle and
 *      brighter at the rim*. That inversion is the whole illusion: a solid ball
 *      is brightest where the light hits it, a glass one is brightest at its
 *      edge, because that is where you are looking through the most of it.
 *   3. **The lattice** — a real rotated wireframe, projected point by point,
 *      with each segment faded by its own depth. Drawn only on the near
 *      hemisphere, which is what stops it reading as a flat circle with a
 *      pattern on it.
 *   4. **The blobs** — liquid masses that sit on the shell. Some are placed
 *      near the silhouette on purpose, so they break the outline: the sphere
 *      should never look perfectly enclosed, because a thing that is contained
 *      is a thing that is finished.
 *
 * Everything is a pure function of a `SphereFrame`, including the blobs, which
 * come from a seeded generator rather than `Math.random()`. That matters more
 * than it sounds: unseeded noise reshuffles every frame and the blobs boil
 * instead of flowing.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface SpherePalette {
  /** The shell's own colour. */
  sphere: Rgb;
  /** The deeper step used at the rim and in the glow's outer falloff. */
  deep: Rgb;
  /** The core, near-white. */
  core: Rgb;
  /** The ground the sphere sits on, so the glow can fade into it honestly. */
  ground: Rgb;
}

/** How a mood changes the way the same sphere behaves. */
export interface MoodParams {
  /** Multiplies core brightness. */
  coreGain: number;
  /** Multiplies every rate of change. Low values read as deadpan, high as giddy. */
  motion: number;
  /** Multiplies blob prominence. */
  blob: number;
  /** A fixed roll, in radians. Small; a tilt is a posture, not a spin. */
  tilt: number;
  /** Multiplies the resting radius. */
  radius: number;
  /** Sharpens (above 1) or flattens (below 1) the shell gradient. */
  contrast: number;
}

export const MOODS: Record<OrbMood, MoodParams> = {
  even: { coreGain: 1, motion: 1, blob: 1, tilt: 0, radius: 1, contrast: 1 },
  bright: { coreGain: 1.35, motion: 1.15, blob: 1.1, tilt: 0, radius: 1.02, contrast: 1.1 },
  // Deadpan is not "off". It is the same creature holding still on purpose,
  // which is why the core stays lit while the motion drops away.
  deadpan: { coreGain: 0.82, motion: 0.5, blob: 0.66, tilt: -0.07, radius: 0.98, contrast: 0.92 },
  mischief: { coreGain: 1.12, motion: 1.5, blob: 1.4, tilt: 0.11, radius: 1.01, contrast: 1.18 },
  grave: { coreGain: 0.7, motion: 0.55, blob: 0.72, tilt: 0, radius: 0.94, contrast: 0.84 },
  tender: { coreGain: 1.06, motion: 0.78, blob: 1.08, tilt: -0.04, radius: 1.04, contrast: 0.94 },
};

export interface SphereFrame {
  /** CSS pixels; the drawing is done in CSS pixels and the caller scales. */
  size: number;
  /** Seconds since mount, frozen when `still`. */
  time: number;
  /** 0..1 smoothed output level. The only thing that drives "speaking". */
  level: number;
  /** 0..1 how gathered the shell is. 1 is open; lower reads as concentrating. */
  openness: number;
  mood: MoodParams;
  palette: SpherePalette;
  /** The costume, drawn last so it sits over everything. */
  traits: PersonaTrait[];
  /** Reduced motion: one settled frame, no rotation, no drift. */
  still: boolean;
}

/* ------------------------------------------------------------------ */
/* Colour                                                              */
/* ------------------------------------------------------------------ */

export function parseRgb(value: string, fallback: Rgb): Rgb {
  const match = /^\s*#?([0-9a-f]{6})\s*$/i.exec(value.trim());
  if (!match?.[1]) return fallback;
  const hex = match[1];
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

/** `t` of 0 is all `a`, 1 is all `b`. */
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const k = Math.max(0, Math.min(1, t));
  return {
    r: a.r + (b.r - a.r) * k,
    g: a.g + (b.g - a.g) * k,
    b: a.b + (b.b - a.b) * k,
  };
}

function rgba(c: Rgb, alpha: number): string {
  const clamp = (v: number) => Math.round(Math.max(0, Math.min(255, v)));
  return `rgba(${clamp(c.r)}, ${clamp(c.g)}, ${clamp(c.b)}, ${Math.max(0, Math.min(1, alpha))})`;
}

/* ------------------------------------------------------------------ */
/* Deterministic noise                                                 */
/* ------------------------------------------------------------------ */

/**
 * A small integer hash. Used instead of `Math.random()` so the same index
 * always yields the same blob — see the note at the top of the file.
 */
function hash01(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

const TAU = Math.PI * 2;
/** A shallow tilt, so the equator is legible and the globe does not roll. */
const AXIAL_TILT = -0.31;

/** Rotates a unit-sphere point by the sphere's yaw, then its fixed tilt. */
function orient(
  x: number,
  y: number,
  z: number,
  yaw: number,
): { x: number; y: number; z: number } {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const x1 = x * cy + z * sy;
  const z1 = -x * sy + z * cy;
  const ct = Math.cos(AXIAL_TILT);
  const st = Math.sin(AXIAL_TILT);
  return { x: x1, y: y * ct - z1 * st, z: y * st + z1 * ct };
}

interface Blob {
  /** Longitude and latitude of its seat on the shell. */
  lon: number;
  lat: number;
  /** Distance from centre, as a multiple of the radius. */
  distance: number;
  /** Resting size as a multiple of the radius. */
  radius: number;
  /**
   * Three harmonics summed to make the outline.
   *
   * The first pass used one frequency plus its octave, which is a regular
   * n-pointed star — every blob came out as the same four-pointed asterisk, and
   * a field of identical asterisks reads as a pattern, not as liquid. These are
   * three different integer frequencies per blob with no common multiple, so
   * the sum has no symmetry to recognise. They have to stay integers: the path
   * closes by returning to angle zero, and a fractional frequency leaves a seam
   * where the outline fails to meet itself.
   */
  lobes: readonly [number, number, number];
  wobble: number;
  phase: number;
  drift: number;
  alpha: number;
  /** True for the lighter, higher blobs — they read as nearer the light. */
  pale: boolean;
}

const BLOB_COUNT = 10;

function makeBlobs(): Blob[] {
  const blobs: Blob[] = [];
  for (let i = 0; i < BLOB_COUNT; i++) {
    const h = (k: number) => hash01(i * 977 + k * 131);
    // Longitude is spread evenly with jitter; latitude runs the full range
    // rather than hugging the belt, so the liquid is not a necklace.
    const lon = (i / BLOB_COUNT) * TAU + h(1) * 0.9;
    const lat = (h(2) * 2 - 1) * 1.25;
    blobs.push({
      lon,
      lat,
      /*
       * Mostly outside the silhouette, deliberately.
       *
       * These are the ones that stop the shell closing, which is the stated
       * shape of the thing. Pushing them outward also clears the middle of the
       * sphere so the core has somewhere to be bright — the first pass parked
       * blobs over the centre and then competed with its own light source.
       */
      distance: 0.8 + h(3) * 0.44,
      /*
       * Squared, so most blobs are small and a couple are large.
       *
       * An even spread over a wide range gave ten blobs of much the same size,
       * which read as a belt of beads. Liquid has a size distribution: a few
       * masses and a lot of small satellite drops.
       */
      radius: 0.11 + h(4) * h(4) * 0.34,
      lobes: [2 + Math.floor(h(5) * 2), 3 + Math.floor(h(5) * 3), 5 + Math.floor(h(6) * 4)],
      wobble: 0.14 + h(6) * 0.16,
      phase: h(7) * TAU,
      drift: 0.4 + h(8) * 0.9,
      // Semi-transparent on purpose: the lattice has to stay visible through
      // them or they stop being liquid on glass and become stickers.
      alpha: 0.34 + h(9) * 0.4,
      // A minority. A pale blob is a highlight on the liquid; too many of them
      // and the liquid stops having a colour of its own.
      pale: h(10) > 0.74,
    });
  }
  return blobs;
}

const BLOBS = makeBlobs();

/* ------------------------------------------------------------------ */
/* The frame                                                           */
/* ------------------------------------------------------------------ */

export function drawSphere(ctx: CanvasRenderingContext2D, frame: SphereFrame): void {
  const { size, palette, mood } = frame;
  const cx = size / 2;
  const cy = size / 2;

  // The shell grows when it speaks. Calling this "expansion" rather than
  // "scale" is deliberate: it is a breath, not a zoom, so the growth is small
  // and most of the effect is spent on the core and the blobs instead.
  const breathe = 1 + frame.level * 0.075;
  const radius = size * 0.3 * mood.radius * frame.openness * breathe;
  const level = frame.level;

  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.translate(cx, cy);
  if (mood.tilt !== 0) ctx.rotate(mood.tilt);

  const yaw = frame.still ? 0.7 : frame.time * 0.11 * mood.motion;

  drawGlow(ctx, size, radius, palette, mood, level);
  drawBlobs(ctx, frame, radius, yaw, -1);
  drawShell(ctx, radius, palette, mood, level);
  drawLattice(ctx, radius, palette, yaw, mood);
  drawCore(ctx, radius, palette, mood, level);
  drawBlobs(ctx, frame, radius, yaw, 1);
  drawTraits(ctx, frame, radius);

  ctx.restore();
}

function drawGlow(
  ctx: CanvasRenderingContext2D,
  size: number,
  radius: number,
  palette: SpherePalette,
  mood: MoodParams,
  level: number,
): void {
  const reach = radius * (1.5 + level * 0.5);
  const wash = ctx.createRadialGradient(0, 0, radius * 0.2, 0, 0, reach);
  const strength = 0.17 * mood.coreGain * (1 + level * 0.6);
  wash.addColorStop(0, rgba(palette.sphere, strength));
  wash.addColorStop(0.35, rgba(palette.sphere, strength * 0.45));
  // Faded to the sphere's own colour at zero alpha rather than to `ground`. The
  // ground is very nearly white, and fading toward it leaves a grey ring at the
  // edge of the bloom — a visible seam where the light is supposed to end.
  wash.addColorStop(1, rgba(palette.sphere, 0));
  ctx.fillStyle = wash;
  ctx.beginPath();
  ctx.arc(0, 0, reach, 0, TAU);
  ctx.fill();
}

function drawShell(
  ctx: CanvasRenderingContext2D,
  radius: number,
  palette: SpherePalette,
  mood: MoodParams,
  level: number,
): void {
  /*
   * Almost nothing in the middle, and all the weight at the rim.
   *
   * The first pass filled the whole disc at a fifth to a third opacity, which
   * on a white ground reads as a solid balloon. The reference is glass: you are
   * meant to see the page through it, and the shape is legible because of its
   * *edge*, not its fill. So the interior sits near zero and the last 15% of the
   * radius carries the whole thing — a thin, saturated band right at the
   * silhouette, where a sphere seen through glass actually gathers its light.
   */
  const contrast = mood.contrast * (1 + level * 0.22);
  const fill = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
  fill.addColorStop(0, rgba(palette.sphere, 0.045 * contrast));
  fill.addColorStop(0.62, rgba(palette.sphere, 0.06 * contrast));
  fill.addColorStop(0.88, rgba(palette.sphere, 0.17 * contrast));
  fill.addColorStop(0.965, rgba(palette.deep, 0.44 * contrast));
  fill.addColorStop(1, rgba(palette.deep, 0.68 * contrast));

  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TAU);
  ctx.fillStyle = fill;
  ctx.fill();

  // A single brighter pass right at the edge, which is what sells "glass".
  ctx.beginPath();
  ctx.arc(0, 0, radius - radius * 0.012, 0, TAU);
  ctx.strokeStyle = rgba(mix(palette.sphere, palette.core, 0.5), 0.55 * mood.contrast);
  ctx.lineWidth = Math.max(1, radius * 0.016);
  ctx.stroke();
}

/**
 * The wireframe.
 *
 * Every line is sampled into short segments and each segment is faded by the
 * depth of its own midpoint. **Both hemispheres are drawn**, the far one at
 * roughly a fifth of the near one's weight. This is the single change that made
 * the difference between a wireframe globe and a circle with some arcs on it:
 * seeing the far-side lines *through* the shell is what tells the eye it is
 * looking at a transparent volume, and no amount of rim shading substitutes for
 * it.
 */
function drawLattice(
  ctx: CanvasRenderingContext2D,
  radius: number,
  palette: SpherePalette,
  yaw: number,
  mood: MoodParams,
): void {
  const STEPS = 64;
  ctx.lineWidth = Math.max(0.7, radius * 0.009);

  /*
   * Segments are stroked in a handful of alpha buckets rather than one path
   * each. A per-segment stroke is ~1500 draw calls a frame at this resolution,
   * and the depth fade is smooth enough that eight steps of alpha across it
   * are invisible on a line this thin.
   */
  const BUCKETS = 8;
  const stroke = (points: { x: number; y: number; z: number }[], alpha: number) => {
    for (let bucket = 0; bucket < BUCKETS; bucket++) {
      const lo = bucket / BUCKETS;
      const hi = (bucket + 1) / BUCKETS;
      ctx.beginPath();
      let drew = false;
      for (let i = 0; i < points.length - 1; i++) {
        const p = points[i]!;
        const q = points[i + 1]!;
        const depth = (p.z + q.z) / 2;
        // Continuous from far side to near, never to zero: the far side is
        // faint, not absent.
        const a = (0.2 + 0.8 * smoothstep(-1, 0.9, depth)) * alpha;
        if (a < lo || a >= hi) continue;
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
        drew = true;
      }
      if (!drew) continue;
      ctx.strokeStyle = rgba(palette.deep, (lo + hi) / 2);
      ctx.stroke();
    }
  };

  const project = (lat: number, lon: number) => {
    const cl = Math.cos(lat);
    const p = orient(cl * Math.sin(lon), Math.sin(lat), cl * Math.cos(lon), yaw);
    return { x: p.x * radius, y: -p.y * radius, z: p.z };
  };

  const base = 0.62 * mood.contrast;

  // Eight rings and eight meridians. The first pass used four and six, which is
  // a beach ball; this is dense enough to read as a surveyed surface.
  for (let latIndex = 1; latIndex <= 8; latIndex++) {
    const lat = -Math.PI / 2 + (latIndex / 9) * Math.PI;
    const points = [];
    for (let i = 0; i <= STEPS; i++) points.push(project(lat, (i / STEPS) * TAU));
    stroke(points, base);
  }

  for (let lonIndex = 0; lonIndex < 8; lonIndex++) {
    const lon = (lonIndex / 8) * Math.PI;
    const points = [];
    for (let i = 0; i <= STEPS; i++) points.push(project(-Math.PI / 2 + (i / STEPS) * Math.PI, lon));
    stroke(points, base * 0.85);
  }
}

function drawCore(
  ctx: CanvasRenderingContext2D,
  radius: number,
  palette: SpherePalette,
  mood: MoodParams,
  level: number,
): void {
  const gain = mood.coreGain * (1 + level * 0.7);
  // Small and hot. The previous version reached 40% of the radius and read as a
  // lit ball rather than as a light source inside something.
  const coreRadius = radius * (0.26 + level * 0.08);
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, coreRadius);
  core.addColorStop(0, rgba(palette.core, Math.min(1, 0.96 * gain)));
  core.addColorStop(0.2, rgba(palette.core, Math.min(1, 0.82 * gain)));
  core.addColorStop(0.48, rgba(mix(palette.core, palette.sphere, 0.3), 0.34 * gain));
  core.addColorStop(1, rgba(palette.sphere, 0));
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(0, 0, coreRadius, 0, TAU);
  ctx.fill();

  /*
   * A tight white centre inside the gradient above. Without it the falloff has
   * no floor to fall from and the core reads as a haze; with it there is a
   * point the light is obviously coming *from*, which is what the level is
   * actually modulating when the sphere talks.
   */
  const hot = radius * (0.07 + level * 0.035);
  const centre = ctx.createRadialGradient(0, 0, 0, 0, 0, hot);
  centre.addColorStop(0, rgba(palette.core, Math.min(1, 0.98 * gain)));
  centre.addColorStop(1, rgba(palette.core, 0));
  ctx.fillStyle = centre;
  ctx.beginPath();
  ctx.arc(0, 0, hot, 0, TAU);
  ctx.fill();
}

function drawBlobs(
  ctx: CanvasRenderingContext2D,
  frame: SphereFrame,
  radius: number,
  yaw: number,
  layer: -1 | 1,
): void {
  const { palette, mood, level } = frame;
  const t = frame.still ? 0 : frame.time;

  for (const blob of BLOBS) {
    const cl = Math.cos(blob.lat);
    const base = orient(
      cl * Math.sin(blob.lon),
      Math.sin(blob.lat),
      cl * Math.cos(blob.lon),
      yaw,
    );
    /*
     * Which pass a blob belongs to.
     *
     * The cut is deliberately *behind* the equator rather than at it, so the
     * blobs sitting near the rim — where z is almost zero — are drawn in the
     * front pass. Those are the ones that break the silhouette, and clipping
     * them at z > 0 would leave the sphere perfectly enclosed, which is the
     * one thing this shape is not supposed to be.
     */
    const inFront = base.z >= -0.05;
    if (inFront !== layer > 0) continue;

    // Push outward as the level rises: speaking disturbs the surface.
    const distance = radius * blob.distance * (1 + level * 0.14 * mood.blob);
    const px = base.x * distance;
    const py = -base.y * distance;

    const apparent =
      radius * blob.radius * mood.blob * (0.78 + 0.34 * (base.z * 0.5 + 0.5)) * (1 + level * 0.18);

    const depthFade = layer > 0 ? 1 : 0.5;
    // Much less whitening than the first pass. Mixing 34% toward a near-white
    // core turned most of the liquid grey; these are *blue*, and the contrast
    // they strike against the pale shell is the whole reason the sphere looks
    // like it has something moving inside it.
    const colour = blob.pale ? mix(palette.sphere, palette.core, 0.2) : palette.deep;

    // A soft body under the outline, so the blob looks like it has volume
    // rather than being a flat splat sitting on the glass. Kept low — this is
    // only here to stop the edge looking die-cut.
    const body = ctx.createRadialGradient(px, py, 0, px, py, apparent * 1.45);
    body.addColorStop(0, rgba(colour, blob.alpha * 0.24 * depthFade));
    body.addColorStop(1, rgba(colour, 0));
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(px, py, apparent * 1.45, 0, TAU);
    ctx.fill();

    blobPath(ctx, px, py, apparent, blob, t * blob.drift * mood.motion);
    const shade = ctx.createRadialGradient(
      px - apparent * 0.32,
      py - apparent * 0.32,
      apparent * 0.05,
      px,
      py,
      apparent,
    );
    shade.addColorStop(0, rgba(mix(colour, palette.core, 0.4), blob.alpha * 0.92 * depthFade));
    shade.addColorStop(0.62, rgba(colour, blob.alpha * 1.05 * depthFade));
    // Held near full opacity at the edge. Fading the outline out is what made
    // the first pass look like a smudge; a liquid has a surface.
    shade.addColorStop(0.94, rgba(mix(colour, palette.deep, 0.35), blob.alpha * depthFade));
    shade.addColorStop(1, rgba(mix(colour, palette.deep, 0.35), blob.alpha * 0.85 * depthFade));
    ctx.fillStyle = shade;
    ctx.fill();
  }
}

/**
 * An organic outline.
 *
 * Sampled radii are joined with quadratic curves through the midpoints of
 * consecutive samples. Straight lines would need far more samples to look
 * smooth, and a spline through the samples themselves would overshoot and
 * produce spikes at high wobble.
 */
function blobPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  blob: Blob,
  drift: number,
): void {
  const SAMPLES = 26;
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const angle = (i / SAMPLES) * TAU;
    const [f1, f2, f3] = blob.lobes;
    // Weighted so the lowest harmonic sets the overall gesture and the higher
    // two only ruffle its edge — equal weights give a spiky, crystalline shape
    // that reads as a shard of glass rather than a drop of liquid.
    const wobble =
      Math.sin(angle * f1 + blob.phase + drift) * 0.5 +
      Math.sin(angle * f2 - blob.phase * 1.7 + drift * 0.6) * 0.3 +
      Math.sin(angle * f3 + blob.phase * 2.3 - drift * 0.4) * 0.2;
    const r = radius * (1 + blob.wobble * wobble);
    points.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
  }

  const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  });

  const start = mid(points[SAMPLES - 1]!, points[0]!);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  for (let i = 0; i < SAMPLES; i++) {
    const p = points[i]!;
    const next = points[(i + 1) % SAMPLES]!;
    const m = mid(p, next);
    ctx.quadraticCurveTo(p.x, p.y, m.x, m.y);
  }
  ctx.closePath();
}

/* ------------------------------------------------------------------ */
/* Traits                                                              */
/* ------------------------------------------------------------------ */

/**
 * The costume.
 *
 * Each ornament is anchored to a fixed place on the shell and scaled by the
 * trait's own `scale`, so the same hat sits in the same spot on every sphere
 * and a persona cannot subtly re-place a face. `offset` is the only freedom,
 * and it is small.
 *
 * These are drawn from the trait list alone and not from the worker's
 * vocabulary descriptors: the worker's job is to *refuse* a costume, and a
 * renderer has to own its own geometry to stay sharp at every size. The two
 * agreeing is a property worth having, but making one derive from the other
 * would mean a validation tweak could silently move a hat.
 */
function drawTraits(ctx: CanvasRenderingContext2D, frame: SphereFrame, radius: number): void {
  for (const trait of frame.traits) {
    const r = radius * trait.scale;
    const ox = (trait.offset?.x ?? 0) * radius;
    const oy = (trait.offset?.y ?? 0) * radius;
    ctx.save();
    ctx.translate(ox, oy);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    drawTrait(ctx, trait, r);
    ctx.restore();
  }
}

function drawTrait(ctx: CanvasRenderingContext2D, trait: PersonaTrait, r: number): void {
  const colour = parseRgb(trait.color, { r: 255, g: 255, b: 255 });
  const solid = rgba(colour, 0.95);
  const line = Math.max(1.2, r * 0.035);

  switch (trait.kind) {
    case 'hat': {
      // A soft cap that sits over the crown and slumps to one side.
      ctx.beginPath();
      ctx.moveTo(-r * 0.82, -r * 0.66);
      ctx.quadraticCurveTo(-r * 0.5, -r * 1.42, r * 0.22, -r * 1.3);
      ctx.quadraticCurveTo(r * 0.95, -r * 1.2, r * 0.86, -r * 0.6);
      ctx.closePath();
      ctx.fillStyle = solid;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-r * 0.92, -r * 0.64);
      ctx.quadraticCurveTo(0, -r * 0.44, r * 0.95, -r * 0.58);
      // Edge first, then the white band over it — same reason as the beard:
      // a white brim on a white page has no edge of its own.
      ctx.lineWidth = line * 2.9;
      ctx.strokeStyle = rgba({ r: 176, g: 188, b: 206 }, 0.5);
      ctx.stroke();
      ctx.lineWidth = line * 2.2;
      ctx.strokeStyle = rgba({ r: 255, g: 255, b: 255 }, 0.95);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(r * 0.96, -r * 1.06, r * 0.2, 0, TAU);
      ctx.fillStyle = rgba({ r: 255, g: 255, b: 255 }, 0.95);
      ctx.fill();
      break;
    }
    case 'cap': {
      // Flat rather than round — a cap is a disc, and the silhouette says so.
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.74, r * 0.88, r * 0.3, -0.08, 0, TAU);
      ctx.fillStyle = solid;
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(r * 0.34, -r * 0.64, r * 0.72, r * 0.16, -0.12, 0, TAU);
      ctx.fillStyle = rgba(colour, 0.8);
      ctx.fill();
      break;
    }
    case 'beard': {
      /*
       * A jaw, not an oval.
       *
       * The first version was a wide ellipse centred on the shell, which read
       * as a paper plate held up in front of the sphere. This starts at cheek
       * height, tapers to a point *below* the silhouette, and has a lip line
       * across the top — so it hangs off the sphere the way a beard does, and
       * breaks the outline the way the blobs do.
       */
      ctx.beginPath();
      ctx.moveTo(-r * 0.6, -r * 0.18);
      ctx.quadraticCurveTo(-r * 0.76, r * 0.48, -r * 0.34, r * 0.88);
      ctx.quadraticCurveTo(-r * 0.14, r * 1.14, 0, r * 1.18);
      ctx.quadraticCurveTo(r * 0.14, r * 1.14, r * 0.34, r * 0.88);
      ctx.quadraticCurveTo(r * 0.76, r * 0.48, r * 0.6, -r * 0.18);
      ctx.quadraticCurveTo(r * 0.28, r * 0.2, 0, r * 0.2);
      ctx.quadraticCurveTo(-r * 0.28, r * 0.2, -r * 0.6, -r * 0.18);
      ctx.closePath();
      ctx.fillStyle = rgba(colour, 0.95);
      ctx.fill();
      /*
       * A hairline edge, because the ground is very nearly white and so is the
       * beard. With a transparent shell behind it there is no contrast to hold
       * the shape, and the bottom of it simply dissolved into the page. Any
       * large light-coloured trait needs this; the dark ones do not.
       */
      ctx.strokeStyle = rgba(mix(colour, { r: 18, g: 30, b: 50 }, 0.34), 0.42);
      ctx.lineWidth = Math.max(1, r * 0.022);
      ctx.stroke();
      break;
    }
    case 'glasses': {
      ctx.strokeStyle = solid;
      ctx.lineWidth = line * 1.5;
      for (const dx of [-r * 0.36, r * 0.36]) {
        ctx.beginPath();
        ctx.roundRect(dx - r * 0.28, -r * 0.24, r * 0.56, r * 0.4, r * 0.12);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(-r * 0.08, -r * 0.05);
      ctx.lineTo(r * 0.08, -r * 0.05);
      ctx.stroke();
      break;
    }
    case 'monocle': {
      ctx.strokeStyle = solid;
      ctx.lineWidth = line * 1.6;
      ctx.beginPath();
      ctx.arc(r * 0.34, -r * 0.06, r * 0.3, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(r * 0.6, r * 0.18);
      ctx.quadraticCurveTo(r * 0.86, r * 0.6, r * 0.6, r * 0.94);
      ctx.lineWidth = line;
      ctx.stroke();
      break;
    }
    case 'horns': {
      ctx.fillStyle = solid;
      for (const sign of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(sign * r * 0.44, -r * 0.72);
        ctx.quadraticCurveTo(sign * r * 0.9, -r * 1.16, sign * r * 0.62, -r * 1.4);
        ctx.quadraticCurveTo(sign * r * 0.6, -r * 1.0, sign * r * 0.24, -r * 0.82);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'antennae': {
      ctx.strokeStyle = solid;
      ctx.lineWidth = line;
      for (const sign of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(sign * r * 0.24, -r * 0.9);
        ctx.quadraticCurveTo(sign * r * 0.52, -r * 1.3, sign * r * 0.34, -r * 1.52);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(sign * r * 0.34, -r * 1.56, r * 0.09, 0, TAU);
        ctx.fillStyle = solid;
        ctx.fill();
      }
      break;
    }
    case 'crown': {
      ctx.beginPath();
      const tips = 5;
      ctx.moveTo(-r * 0.68, -r * 0.82);
      for (let i = 0; i < tips; i++) {
        const x0 = -r * 0.68 + (i * 2 * r * 0.68) / tips;
        const x1 = -r * 0.68 + ((i + 0.5) * 2 * r * 0.68) / tips;
        const x2 = -r * 0.68 + ((i + 1) * 2 * r * 0.68) / tips;
        ctx.lineTo(x1, -r * 1.12);
        ctx.lineTo(x2, -r * 0.82);
      }
      ctx.lineTo(r * 0.68, -r * 0.62);
      ctx.lineTo(-r * 0.68, -r * 0.62);
      ctx.closePath();
      ctx.fillStyle = solid;
      ctx.fill();
      break;
    }
    case 'scarf': {
      ctx.beginPath();
      ctx.moveTo(-r * 0.86, r * 0.5);
      ctx.quadraticCurveTo(0, r * 0.78, r * 0.86, r * 0.44);
      ctx.lineWidth = line * 4;
      ctx.strokeStyle = rgba(colour, 0.92);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(r * 0.6, r * 0.56);
      ctx.quadraticCurveTo(r * 0.78, r * 1.1, r * 0.5, r * 1.32);
      ctx.lineWidth = line * 2.4;
      ctx.stroke();
      break;
    }
    case 'halo': {
      // Clear of the silhouette. At -1.02r it was tangent to the top of the
      // shell and read as a ring lying on the sphere rather than above it.
      ctx.beginPath();
      ctx.ellipse(0, -r * 1.18, r * 0.5, r * 0.12, 0, 0, TAU);
      ctx.lineWidth = line * 1.8;
      ctx.strokeStyle = rgba(colour, 0.85);
      ctx.stroke();
      break;
    }
    case 'visor': {
      // Narrower and thinner than the first pass, which was a bar across the
      // whole shell and obliterated the thing it was supposed to be worn on.
      ctx.beginPath();
      ctx.roundRect(-r * 0.62, -r * 0.2, r * 1.24, r * 0.38, r * 0.17);
      ctx.fillStyle = rgba(colour, 0.88);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-r * 0.42, r * 0.03);
      ctx.lineTo(r * 0.06, -r * 0.12);
      ctx.lineWidth = line;
      ctx.strokeStyle = rgba({ r: 255, g: 255, b: 255 }, 0.55);
      ctx.stroke();
      break;
    }
    case 'ears': {
      ctx.fillStyle = solid;
      for (const sign of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(sign * r * 0.56, -r * 0.62);
        ctx.quadraticCurveTo(sign * r * 0.96, -r * 1.18, sign * r * 0.92, -r * 0.42);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'plume': {
      // Two barbs with a notch between them. A single narrow S-curve, which is
      // what this was, has no width at the base and reads as a strip of bacon.
      ctx.beginPath();
      ctx.moveTo(r * 0.02, -r * 0.88);
      ctx.quadraticCurveTo(-r * 0.36, -r * 1.2, -r * 0.46, -r * 1.66);
      ctx.quadraticCurveTo(-r * 0.16, -r * 1.46, r * 0.02, -r * 1.58);
      ctx.quadraticCurveTo(r * 0.2, -r * 1.32, r * 0.34, -r * 0.98);
      ctx.quadraticCurveTo(r * 0.2, -r * 0.88, r * 0.02, -r * 0.88);
      ctx.closePath();
      ctx.fillStyle = solid;
      ctx.fill();
      break;
    }
    case 'spikes': {
      ctx.fillStyle = solid;
      const count = 11;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * TAU + 0.22;
        const inner = r * 0.94;
        const outer = r * 1.24;
        const spread = 0.1;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a - spread) * inner, Math.sin(a - spread) * inner);
        ctx.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
        ctx.lineTo(Math.cos(a + spread) * inner, Math.sin(a + spread) * inner);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
  }
}
