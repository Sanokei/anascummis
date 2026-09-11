/**
 * Contracts for the design harness.
 *
 * The harness makes a picture by *writing it as source*, rendering it, looking
 * at the result, and saying what is wrong with it. Two things separate this from
 * asking an image model for a picture:
 *
 *   1. **The source is the artifact.** A vector drawing is SVG text and a 3D
 *      asset is a scene program; both are inspectable, diffable, and editable
 *      one named part at a time. Nothing has to be recovered afterwards by
 *      segmentation, because the names were there at generation time.
 *
 *   2. **Most acceptance criteria are settled by arithmetic, not opinion.** A
 *      criterion like "five circles" or "the shade sits above the post" or "the
 *      canvas is 16:9" is a statement about the source and can be checked
 *      exactly. Only the genuinely perceptual remainder — "does this read as a
 *      sunset" — goes to a vision model, and that answer is labelled as the
 *      opinion it is.
 *
 * The second point is the whole design. The specification is explicit that a
 * model approving its own output is not validation, so this harness never
 * routes a criterion through a model when a host check can decide it, and every
 * verdict records which of the two settled it.
 *
 * Nothing in this directory imports Ink, the registry, or a provider. It is
 * plain computation over text and pixels, which is what makes it testable
 * without a browser, a network, or a model.
 */

/* ------------------------------------------------------------------ */
/* Shared vocabulary                                                   */
/* ------------------------------------------------------------------ */

/** Which kind of source an artifact was authored in. */
export type Surface = 'vector' | 'scene';

/**
 * How a criterion was settled. `met` is only ever produced by a host check;
 * a model's view can raise an issue but can never on its own mark a criterion
 * met. See `CriterionVerdict` for how the two are kept apart.
 */
export type Outcome = 'met' | 'not-met' | 'unverifiable';

/**
 * What a criterion was checked against.
 *
 * - `structural` — the source text itself: counts, names, palette, text content.
 * - `geometric`  — measured positions: bounds, overlap, alignment, containment.
 * - `pixel`      — the rendered raster: blankness, clipping, contrast, coverage.
 * - `perceptual` — nothing measurable settles it; only a vision model can opine.
 */
export type CheckKind = 'structural' | 'geometric' | 'pixel' | 'perceptual';

/** Where a verdict's authority comes from. Recorded, never inferred. */
export type VerdictBasis = 'deterministic' | 'opinion-only' | 'unverifiable';

/** A criterion the host could not compile into a check, and why. */
export interface CheckRefusal {
  criterion: string;
  /** Plain language, shown to the person who wrote the criterion. */
  reason: string;
}

/** The outcome of one host-executed check. This is evidence, not opinion. */
export interface DeterministicFinding {
  criterion: string;
  kind: Exclude<CheckKind, 'perceptual'>;
  outcome: Exclude<Outcome, 'unverifiable'> | 'unverifiable';
  /** What was actually measured, in words a person can check. */
  evidence: string;
  /**
   * The numbers behind the call. Present so a reader can disagree with the
   * threshold rather than having to trust the sentence.
   */
  measured: Record<string, number | string | boolean>;
}

/** What the vision model said about one criterion. Always an opinion. */
export interface OpinionFinding {
  criterion: string;
  outcome: Outcome;
  evidence: string;
  /** The model that gave it, named so the verdict is attributable. */
  reviewedBy: string;
}

/**
 * One criterion, resolved.
 *
 * `verified` and `opinion` are both kept even after `outcome` is decided, so a
 * reader can see a disagreement rather than only its resolution. A criterion
 * the model likes but no check settles stays `opinion-only`; it is never
 * promoted to `met`.
 */
export interface CriterionVerdict {
  criterion: string;
  basis: VerdictBasis;
  outcome: Outcome;
  /** The host check that settled it, when one did. */
  verified: DeterministicFinding | null;
  /** The model's view, when one was asked and answered. */
  opinion: OpinionFinding | null;
  /** Set when the two disagree, so the disagreement is not lost. */
  conflict: string | null;
}

export interface DesignReview {
  revisionId: string;
  verdicts: CriterionVerdict[];
  /** True only when every criterion was settled `met` by a host check. */
  allVerified: boolean;
  /** Counts, so a caller cannot reduce the review to a single boolean. */
  counts: { verifiedMet: number; opinionOnly: number; notMet: number; unverifiable: number };
  otherObservations: string[];
  refused: CheckRefusal[];
  reviewedBy: string | null;
  reviewedAt: string;
  /** Travels with every verdict. See REVIEW_CAVEAT. */
  caveat: string;
}

export const REVIEW_CAVEAT =
  'A verdict marked "verified" was settled by a host check against the source or the rendered pixels, and the numbers behind it are recorded. A verdict marked "opinion-only" is a vision model describing a picture; it can miss defects and can report ones that are not there. An opinion is never sufficient on its own.';

/* ------------------------------------------------------------------ */
/* Geometry primitives                                                 */
/* ------------------------------------------------------------------ */

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

/** An axis-aligned box. `null` is used for "nothing here", never a zero box. */
export interface Bounds {
  min: Vec3;
  max: Vec3;
}

export interface Bounds2D {
  min: Vec2;
  max: Vec2;
}

/* ------------------------------------------------------------------ */
/* Vector surface (SVG)                                                */
/* ------------------------------------------------------------------ */

export interface SvgElement {
  /** The `id` attribute, when present. Real handles, not generated names. */
  id: string | null;
  /** Lower-case local tag name. Namespaces are stripped. */
  tag: string;
  attributes: Record<string, string>;
  /** Direct text content, for elements that carry it. */
  text: string;
  children: SvgElement[];
  /** Index in `SvgDocument.all`, so a finding can point at one element. */
  index: number;
}

export interface SvgDocument {
  /** Declared canvas size in user units; `null` when only a viewBox is given. */
  width: number | null;
  height: number | null;
  /** `[minX, minY, width, height]`. Derived from width/height when absent. */
  viewBox: [number, number, number, number];
  root: SvgElement;
  /** Every element in document order, root first. */
  all: SvgElement[];
}

/** A problem that makes a document unusable or unsafe, as opposed to ugly. */
export interface SvgIssue {
  /** Stable, machine-checkable code. */
  code:
    | 'not-xml'
    | 'not-svg'
    | 'script-element'
    | 'event-handler'
    | 'javascript-url'
    | 'foreign-element'
    | 'external-reference'
    | 'duplicate-id'
    | 'unresolved-reference'
    | 'missing-viewbox'
    | 'degenerate-viewbox';
  message: string;
  /** Index into `SvgDocument.all`, or null for a document-level issue. */
  elementIndex: number | null;
}

/**
 * What the source says, counted and measured. Every field here is derived by
 * parsing, so a constraint checked against it is exact rather than estimated.
 */
export interface SvgDigest {
  width: number | null;
  height: number | null;
  viewBox: [number, number, number, number];
  /** Aspect ratio of the viewBox, or null when degenerate. */
  aspectRatio: number | null;
  /** Element counts by tag, e.g. `{ circle: 5, rect: 2 }`. */
  counts: Record<string, number>;
  ids: string[];
  /** Every `fill`/`stroke`/gradient-stop colour, normalised to `#rrggbb`. */
  colors: string[];
  /** Colour name or hex as written, counted. */
  colorCounts: Record<string, number>;
  /** Concatenated text content of all text-bearing elements. */
  text: string[];
  /** Number of `path` elements and the total number of path commands. */
  pathCount: number;
  pathCommandCount: number;
  /** Union of conservatively-estimated element bounds, in user units. */
  contentBounds: Bounds2D | null;
}

/* ------------------------------------------------------------------ */
/* Three-dimensional surface (scene program)                           */
/* ------------------------------------------------------------------ */

export type ScenePrimitive = 'box' | 'cylinder' | 'cone' | 'sphere' | 'torus' | 'group';

export interface SceneMaterial {
  /** `#rrggbb`. */
  color: string;
  /** 0..1. */
  metalness: number;
  /** 0..1. */
  roughness: number;
  opacity: number;
}

/** A named joint, so a part can articulate rather than being a frozen surface. */
export interface SceneJoint {
  /** The part this joint moves. Must name a part in the same scene. */
  part: string;
  type: 'revolute' | 'prismatic';
  axis: Vec3;
  /** Degrees for revolute, scene units for prismatic. */
  min: number;
  max: number;
}

export interface ScenePart {
  /** The semantic handle. Unique within a scene, matched case-sensitively. */
  name: string;
  kind: ScenePrimitive;
  /** Local size in scene units: `[x, y, z]` for a box, or `[radius, height, depth]`. */
  size: Vec3;
  /** Local position relative to the parent. */
  at: Vec3;
  /** Local rotation in degrees, applied XYZ. */
  rotation: Vec3;
  material: SceneMaterial;
  /** Name of the parent part, or null for a root. */
  parent: string | null;
  /** Depth from the nearest root, 0 for a root. */
  depth: number;
  children: ScenePart[];
}

export interface SceneGraph {
  name: string;
  unit: 'm' | 'cm' | 'mm' | 'unit';
  parts: ScenePart[];
  roots: ScenePart[];
  joints: SceneJoint[];
  materials: Record<string, SceneMaterial>;
}

export interface SceneIssue {
  code:
    | 'syntax'
    | 'duplicate-part'
    | 'unknown-parent'
    | 'cycle'
    | 'unknown-kind'
    | 'unknown-material'
    | 'unknown-part'
    | 'bad-joint-range'
    | 'degenerate-size'
    | 'no-parts';
  message: string;
  /** The part or joint named by the issue, when it names one. */
  part: string | null;
}

export interface SceneDigest {
  name: string;
  unit: SceneGraph['unit'];
  /** Part names in declaration order. These are the edit handles. */
  partNames: string[];
  /** Counts by primitive, e.g. `{ cylinder: 2, cone: 1 }`. */
  kindCounts: Record<string, number>;
  partCount: number;
  /** Depth of the deepest part; 0 means a flat scene. */
  maxDepth: number;
  /** Roots, counted so "one object with parts" can be distinguished from "a pile". */
  rootCount: number;
  jointCount: number;
  /** Total world-space bounds of every part, after composing parent transforms. */
  worldBounds: Bounds | null;
  /** World-space bounds of one named part. */
  partBounds: Record<string, Bounds>;
  /** Parts whose world box intersects another's, ignoring declared parentage. */
  overlappingPairs: [string, string][];
  /** Materials by name, after applying defaults. */
  materials: Record<string, SceneMaterial>;
}

/* ------------------------------------------------------------------ */
/* Renderable mesh                                                     */
/* ------------------------------------------------------------------ */

/**
 * A triangle soup in world space, with the part name carried on every triangle.
 *
 * This is the seam between the two halves of the 3D path: the scene module
 * builds it from the scene graph, and the raster module draws it. Keeping it
 * neutral means neither has to know about the other, and a test can hand the
 * rasteriser a single triangle without constructing a whole scene.
 *
 * Flat-shaded deliberately. A vertex with shared normals would look smoother
 * and would also hide exactly the geometry errors a visual check is looking
 * for; faceting makes a bad transform visible.
 */
export interface MeshTriangle {
  /** Indices into `Mesh.positions`. */
  a: number;
  b: number;
  c: number;
  /** World-space unit normal. */
  normal: Vec3;
  /** Base colour, 0..255 per channel. */
  color: [number, number, number];
  opacity: number;
  /** The named part this triangle belongs to, so a defect can name a part. */
  part: string;
}

export interface Mesh {
  /** World-space vertex positions. */
  positions: Vec3[];
  triangles: MeshTriangle[];
}

/** A named camera looking at the origin of a bound. */
export interface ViewSpec {
  name: string;
  /** Direction the camera looks *from*, as an offset from the target. */
  offset: Vec3;
  /** Up vector, so an isometric view does not roll. */
  up: Vec3;
}

/** One rendered view of a mesh, plus the statistics measured on it. */
export interface ViewRender {
  view: string;
  raster: Raster;
  stats: ImageStats;
}

/* ------------------------------------------------------------------ */
/* Raster surface                                                      */
/* ------------------------------------------------------------------ */

/** A decoded image: 8-bit RGBA, row-major, top-left origin. */
export interface Raster {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

export interface PaletteEntry {
  hex: string;
  /** Fraction of non-transparent pixels with this colour, 0..1. */
  share: number;
}

/**
 * Measurable properties of a rendered picture.
 *
 * These are what make "the image looks good" partly checkable. They cannot say
 * whether a drawing is *good*, but they settle blankness, clipping, contrast
 * and palette claims exactly.
 */
export interface ImageStats {
  width: number;
  height: number;
  /** Distinct colours, after dropping fully transparent pixels. */
  distinctColors: number;
  /** The most common drawn colour, as `#rrggbb`. */
  background: string;
  backgroundShare: number;
  palette: PaletteEntry[];
  /**
   * Fraction of border pixels that differ from the background. High values mean
   * content is running off the edge, which usually means it was placed badly.
   */
  edgeCoverage: number;
  /** WCAG contrast between the background and the dominant other colour. */
  contrastRatio: number;
  meanLuminance: number;
  /** True when almost nothing was drawn. */
  blank: boolean;
  /** Fraction of the canvas covered by non-background pixels. */
  inkCoverage: number;
}

/* ------------------------------------------------------------------ */
/* Revisions                                                           */
/* ------------------------------------------------------------------ */

export interface DesignRevision {
  id: string;
  sessionId: string;
  userId: string | null;
  surface: Surface;
  /** The authored source. This is the artifact, not a description of one. */
  source: string;
  /** sha-256 of the source, hex. Identifies the content, not the moment. */
  sourceHash: string;
  /** Set once a render has been produced for this revision. */
  renderKey: string | null;
  createdAt: string;
}

export interface DesignLab {
  id: string;
  sessionId: string;
  userId: string | null;
  title: string;
  surface: Surface;
  criteria: string[];
  state: 'open' | 'closed';
  rounds: number;
  createdAt: string;
}

/**
 * The ceiling on revisions in one design lab.
 *
 * Four, not more, because the authored workflow the product is described with
 * is an initial attempt plus up to three revision rounds (personality.md). A
 * lab that kept going would produce rounds nobody asked for and would spend the
 * budget that the honest answer — "this criterion is not met and I cannot make
 * it met" — needs to be reachable.
 */
export const MAX_ROUNDS_PER_DESIGN_LAB = 4;

export const DEFAULT_MATERIAL: SceneMaterial = {
  color: '#b0b0b0',
  metalness: 0,
  roughness: 0.6,
  opacity: 1,
};
