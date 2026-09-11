import type { PersonaTraitKind } from '@shared/types';
import { PERSONA_TRAIT_KINDS } from '@shared/types';

/**
 * What each ornament is, where it sits, and how big it runs — as declared data.
 *
 * This is the worker's account of a costume, not a drawing. The renderer owns
 * its own geometry, deliberately (see `orb-draw.ts` in the client, which says
 * the same thing from the other side: a validation tweak must not silently move
 * a hat). The two agree because the numbers below were taken from the drawing
 * the client actually makes — anchors are the centre of each ornament in that
 * drawing, with y up and the shell's radius as the unit — but neither derives
 * from the other, and this file is the one the *harness* can do arithmetic on.
 *
 * Everything here is about placement in a plane, not in space. The shell is a
 * sphere and the ornaments land on it, but a costume that reads correctly from
 * the front is the whole requirement, so a trait has an x, a y and no z.
 */

/* ------------------------------------------------------------------ */
/* Regions                                                             */
/* ------------------------------------------------------------------ */

/**
 * The parts of the shell an ornament can claim.
 *
 * Two ornaments in the same region, close enough to touch, are two things
 * drawn on top of each other — that is the collision the harness refuses. The
 * regions are coarse on purpose: they are the parts a person would name when
 * describing a costume ("a hat, a beard and a scarf"), and a finer partition
 * would start refusing pairs that plainly work.
 *
 * They overlap each other, and that is not a mistake. The key is what is
 * compared; the ranges only exist so a descriptor's anchor can be checked
 * against the region it claims.
 */
export type TraitRegion = 'crown' | 'face' | 'jaw' | 'neck' | 'side' | 'shell';

export interface RegionDescriptor {
  /** Inclusive y range the anchors in this region fall in. */
  y: [number, number];
  /** Inclusive |x| range, for regions that are defined by being off-centre. */
  absX: [number, number] | null;
  /** Where this is, in words, for a refusal message to use. */
  where: string;
}

export const TRAIT_REGIONS: Record<TraitRegion, RegionDescriptor> = {
  crown: { y: [0.5, 1.5], absX: null, where: 'the top of the shell' },
  face: { y: [-0.3, 0.5], absX: null, where: 'across the face' },
  jaw: { y: [-1.1, -0.3], absX: null, where: 'below the face' },
  neck: { y: [-1.5, -0.45], absX: null, where: 'around the neck' },
  side: { y: [0.3, 1.3], absX: [0.5, 1.1], where: 'the sides of the shell' },
  shell: { y: [-1.3, 1.3], absX: [0, 1.3], where: 'the whole surface' },
};

/**
 * The region the harness does not police.
 *
 * `shell` is the creature's own surface — spikes, a pelt, grit — and it is
 * drawn *behind* whatever is on top, radiating from under the silhouette. It is
 * the one region that may coexist with everything, because a creature with
 * spines and a crown is a creature with a crown, not a collision.
 */
export const UNPOLICED_REGION: TraitRegion = 'shell';

/* ------------------------------------------------------------------ */
/* Colour roles                                                        */
/* ------------------------------------------------------------------ */

/**
 * What register a colour is in.
 *
 * Not a licence to be dim: every ornament is a large shape against the shell,
 * so every one of them carries the same contrast floor (see the harness). The
 * role says which direction to reach in, and gives an author one colour per
 * register that has already been checked against the shells in `authored.ts`,
 * so a costume is assembled from a palette rather than from six ad-hoc greys
 * that nearly match.
 */
export type TraitRole = 'ornament' | 'garment' | 'creature';

export interface RoleDescriptor {
  /** A starting colour, as `#rrggbb`. Checked against every authored shell. */
  color: string;
  note: string;
}

export const TRAIT_ROLES: Record<TraitRole, RoleDescriptor> = {
  ornament: {
    color: '#e8c37a',
    note: 'worked metal, leather, glass: a thing the creature is wearing.',
  },
  garment: {
    // Not a deeper red: cloth has to clear the same floor as metal does, and
    // the olive shell a naturalist wears is the one that decides how light a
    // red has to be before it can be seen against every shell in the set.
    color: '#e2685c',
    note: 'cloth: warmer and softer than metal, and flat rather than shiny.',
  },
  creature: {
    color: '#8fd0c0',
    note: 'a part of the animal — horn, ear, feather, pelt. Reads as flesh, not as kit.',
  },
};

/* ------------------------------------------------------------------ */
/* Traits                                                              */
/* ------------------------------------------------------------------ */

export interface TraitDescriptor {
  kind: PersonaTraitKind;
  /** Centre of the ornament, in shell radii, y up, x to the right. */
  anchor: { x: number; y: number };
  /** Which part of the shell it claims. See `TRAIT_REGIONS`. */
  region: TraitRegion;
  /**
   * How far it runs sideways from its anchor, in shell radii, at scale 1.
   *
   * This is the number the collision check uses: two ornaments in one region
   * whose sideways reaches meet are drawn over each other.
   */
  halfWidth: number;
  /**
   * The drawing radius this ornament is drawn at when the persona does not say
   * otherwise, in shell radii. A trait's own `scale` multiplies it.
   *
   * Distinct from `halfWidth` because they answer different questions: how big
   * the thing is drawn, and how much room it takes up where it sits. A scarf is
   * wide and thin; a monocle is small and round.
   */
  naturalScale: number;
  /** The colour to reach for when the author has no reason to choose. */
  role: TraitRole;
  /** One clause, so a refusal can say what it is refusing. */
  note: string;
}

/**
 * Every ornament, and the only ones there are.
 *
 * Keyed by the union rather than written as a list, so a kind added to
 * `PersonaTraitKind` without an entry here fails to build instead of becoming
 * an ornament the harness cannot place.
 */
export const TRAIT_VOCABULARY: Record<PersonaTraitKind, TraitDescriptor> = {
  hat: {
    kind: 'hat',
    anchor: { x: 0, y: 0.93 },
    region: 'crown',
    halfWidth: 0.94,
    naturalScale: 1.05,
    role: 'garment',
    note: 'a brimmed hat, wide enough to change the silhouette by itself',
  },
  cap: {
    kind: 'cap',
    anchor: { x: 0, y: 0.74 },
    region: 'crown',
    halfWidth: 0.88,
    naturalScale: 0.95,
    role: 'garment',
    note: 'a soft cap, flat where a hat is round',
  },
  beard: {
    kind: 'beard',
    anchor: { x: 0, y: -0.5 },
    region: 'jaw',
    halfWidth: 0.9,
    naturalScale: 0.95,
    role: 'creature',
    note: 'a full beard, from the cheeks down',
  },
  glasses: {
    kind: 'glasses',
    anchor: { x: 0, y: 0.04 },
    region: 'face',
    halfWidth: 0.64,
    naturalScale: 0.95,
    role: 'ornament',
    note: 'a pair of round lenses',
  },
  monocle: {
    kind: 'monocle',
    anchor: { x: 0.34, y: 0.06 },
    region: 'face',
    halfWidth: 0.3,
    naturalScale: 0.75,
    role: 'ornament',
    note: 'one lens, off to one side, with a chain',
  },
  horns: {
    kind: 'horns',
    anchor: { x: 0, y: 1.06 },
    region: 'crown',
    halfWidth: 0.9,
    naturalScale: 1.0,
    role: 'creature',
    note: 'a pair of horns curving out and up',
  },
  antennae: {
    kind: 'antennae',
    anchor: { x: 0, y: 1.23 },
    region: 'crown',
    halfWidth: 0.43,
    naturalScale: 0.9,
    role: 'creature',
    note: 'two stalks with a bead on each end',
  },
  crown: {
    kind: 'crown',
    anchor: { x: 0, y: 0.87 },
    region: 'crown',
    halfWidth: 0.68,
    naturalScale: 0.85,
    role: 'ornament',
    note: 'a band with points, worn low on the crown',
  },
  scarf: {
    kind: 'scarf',
    anchor: { x: 0, y: -0.62 },
    region: 'neck',
    halfWidth: 0.86,
    naturalScale: 1.0,
    role: 'garment',
    note: 'a scarf wrapped at the neck, with one end hanging',
  },
  halo: {
    kind: 'halo',
    anchor: { x: 0, y: 1.02 },
    region: 'crown',
    halfWidth: 0.56,
    naturalScale: 0.9,
    role: 'ornament',
    note: 'a ring, floating clear of the shell',
  },
  visor: {
    kind: 'visor',
    anchor: { x: 0, y: 0 },
    region: 'face',
    halfWidth: 0.86,
    naturalScale: 0.95,
    role: 'ornament',
    note: 'a single band across the face, which is why it is the widest thing worn there',
  },
  ears: {
    kind: 'ears',
    anchor: { x: 0.76, y: 0.8 },
    region: 'side',
    halfWidth: 0.4,
    naturalScale: 0.7,
    role: 'creature',
    note: 'a pair of pointed ears, drawn mirrored about the centre',
  },
  plume: {
    kind: 'plume',
    anchor: { x: 0.18, y: 1.3 },
    region: 'crown',
    halfWidth: 0.32,
    naturalScale: 0.9,
    role: 'creature',
    note: 'a feather standing up off one side — worn instead of a hat, not beside one',
  },
  spikes: {
    kind: 'spikes',
    anchor: { x: 0, y: 0 },
    region: 'shell',
    halfWidth: 1.24,
    naturalScale: 1.1,
    role: 'creature',
    note: 'spines all the way round, radiating from under the silhouette',
  },
};

/** Present so a caller can iterate; the record above is what is authoritative. */
export const TRAIT_KINDS: readonly PersonaTraitKind[] = PERSONA_TRAIT_KINDS;

export function isTraitKind(value: unknown): value is PersonaTraitKind {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(TRAIT_VOCABULARY, value);
}

export function traitDescriptor(kind: PersonaTraitKind): TraitDescriptor {
  return TRAIT_VOCABULARY[kind];
}

/**
 * Is this point inside the region it claims?
 *
 * The check that keeps this file honest: a descriptor that says `crown` and
 * puts its anchor at the neck would still pass every other rule, because the
 * anchor is only ever used for arithmetic. This is the one place the declared
 * region and the declared anchor are compared.
 */
export function regionContains(region: TraitRegion, point: { x: number; y: number }): boolean {
  const bounds = TRAIT_REGIONS[region];
  if (point.y < bounds.y[0] || point.y > bounds.y[1]) return false;
  if (bounds.absX === null) return true;
  const distance = Math.abs(point.x);
  return distance >= bounds.absX[0] && distance <= bounds.absX[1];
}

/** The colour a role reaches for, or null for a role that does not exist. */
export function roleColor(role: TraitRole): string {
  return TRAIT_ROLES[role].color;
}
