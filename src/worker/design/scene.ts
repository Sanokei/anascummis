/**
 * The compiled-artifact half of the scene surface.
 *
 * An authored scene program is a few dozen lines of text. What comes out of
 * this module is (a) a scene graph with named parts and a real parent-child
 * tree, and (b) a binary glTF container that anything else can open, measure,
 * animate and diff. The names exist here because they were written here; that
 * is the whole advantage over a generator that returns a finished surface and
 * leaves the naming to be recovered afterwards by segmentation.
 *
 * Two conventions are worth stating before the code, because getting either
 * wrong produces a scene that looks plausible and is wrong:
 *
 *   - `at` is a part's *centre* in its parent's space, not its base.
 *   - `partBounds` and `Mesh` are *world* space, composed through every
 *     ancestor. The GLB is not, because its nodes already carry the local
 *     transform; see `sceneToGlb`.
 *
 * Nothing here imports a provider, the registry, or a binding. It is plain
 * arithmetic over text, which is what lets a test pin it exactly.
 */

import { fail, ok, type Result } from '../../shared/types';
import {
  DEFAULT_MATERIAL,
  type Bounds,
  type Mesh,
  type MeshTriangle,
  type SceneDigest,
  type SceneGraph,
  type SceneIssue,
  type SceneJoint,
  type SceneMaterial,
  type ScenePart,
  type ScenePrimitive,
  type Vec3,
} from './types';
import {
  compose4,
  cross3,
  hexToRgb,
  identity4,
  intersectionVolume,
  multiply4,
  normaliseColor,
  normalize3,
  parseNumber,
  parseNumberList,
  parseVec3,
  sub3,
  transformPoint4,
  unionBounds,
  type Mat4,
} from './math';

/* ------------------------------------------------------------------ */
/* The language                                                        */
/* ------------------------------------------------------------------ */

/**
 * Kinds, and what `size` means for each. This table is the one thing a reader
 * needs to place a part correctly, so it is stated here rather than left to be
 * inferred from the tessellators.
 *
 *   box       size = full extents (width, height, depth); centred on the origin
 *   cylinder  size = (radius, height, ignored); axis along Y
 *   cone      size = (radius, height, ignored); base at -height/2, apex at
 *             +height/2, axis along Y
 *   sphere    size = (radius, ignored, ignored)
 *   torus     size = (majorRadius, minorRadius, ignored); ring in the XZ plane
 *   group     size ignored; a container that draws nothing
 *
 * `at` is the part's centre in its parent's space. `size` is required for every
 * kind except `group`.
 */
const SCENE_KINDS: readonly ScenePrimitive[] = ['box', 'cylinder', 'cone', 'sphere', 'torus', 'group'];

const SCENE_UNITS: readonly SceneGraph['unit'][] = ['m', 'cm', 'mm', 'unit'];

/**
 * Facet counts. Deliberately modest: a 24-segment cylinder is round enough that
 * a silhouette test cannot tell, and small enough that a whole scene
 * tessellates inside a unit test. A smoother sphere would cost test time to buy
 * detail no criterion in the harness can measure.
 */
const CYLINDER_SEGMENTS = 24;
const CONE_SEGMENTS = 24;
const SPHERE_SEGMENTS = 24;
const SPHERE_RINGS = 12;
const TORUS_MAJOR_SEGMENTS = 24;
const TORUS_MINOR_SEGMENTS = 12;

/**
 * Scene units per metre. `unit` means the author declared no unit at all, which
 * is treated as metres rather than as an error: a scene that never says keeps
 * the identity scale, and nothing silently rescales.
 */
const UNIT_SCALE: Record<SceneGraph['unit'], number> = { m: 1, cm: 0.01, mm: 0.001, unit: 1 };

/** What a colour that did not resolve draws as. Matches DEFAULT_MATERIAL's grey. */
const UNRESOLVED_RGB: [number, number, number] = [176, 176, 176];

/** Overlap tolerance in cubic scene units, so parts that merely touch are not reported. */
const OVERLAP_TOLERANCE = 1e-6;

/* ------------------------------------------------------------------ */
/* Lexing                                                              */
/* ------------------------------------------------------------------ */

interface Token {
  text: string;
  /** True when the token was written in quotes, which makes it a value and never a key. */
  quoted: boolean;
}

/**
 * Splits one line into tokens, or returns null for an unterminated quote.
 *
 * `#` starts a comment at a *token boundary* and only there. Inside a token it
 * is an ordinary character, which is what lets `color=#b08d57` work without the
 * colour being mistaken for a comment.
 */
function tokenise(line: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === undefined) break;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === '#') break;
    if (ch === '"') {
      const end = line.indexOf('"', i + 1);
      if (end < 0) return null;
      tokens.push({ text: line.slice(i + 1, end), quoted: true });
      i = end + 1;
      continue;
    }
    let end = i;
    while (end < line.length && !/\s/.test(line[end] ?? '')) end += 1;
    tokens.push({ text: line.slice(i, end), quoted: false });
    i = end;
  }
  return tokens;
}

interface FieldSet {
  /** Tokens with no `=`, which carry names and types. */
  positional: Token[];
  /** The text written after each `=`, keyed by the key before it. */
  keys: Map<string, string>;
}

/**
 * Reads `key=value` pairs against the keys a directive accepts.
 *
 * An unrecognised key is a failure rather than a shrug. A typo'd `parnet=base`
 * that was quietly dropped would leave a part at the root, and the scene would
 * still parse, validate and render — as a different object.
 */
function readFields(
  line: number,
  directive: string,
  argv: Token[],
  accepted: readonly string[],
): Result<FieldSet> {
  const positional: Token[] = [];
  const keys = new Map<string, string>();
  for (const token of argv) {
    const equals = token.quoted ? -1 : token.text.indexOf('=');
    if (equals < 0) {
      positional.push(token);
      continue;
    }
    const key = token.text.slice(0, equals);
    const value = token.text.slice(equals + 1);
    if (!key) {
      return fail('invalid-argument', `Line ${line}: "${token.text}" has no key before the "=".`);
    }
    if (!accepted.includes(key)) {
      return fail(
        'invalid-argument',
        `Line ${line}: "${key}" is not a key that "${directive}" accepts (${accepted.join(', ')}).`,
      );
    }
    if (keys.has(key)) {
      return fail('invalid-argument', `Line ${line}: "${key}" is given twice on the same line.`);
    }
    if (!value) {
      return fail('invalid-argument', `Line ${line}: "${key}" has no value.`);
    }
    keys.set(key, value);
  }
  return ok({ positional, keys });
}

/** The single name a directive takes, or a failure naming what was written instead. */
function readName(line: number, directive: string, positional: Token[]): Result<string> {
  if (positional.length === 0) {
    return fail('invalid-argument', `Line ${line}: "${directive}" needs a name.`);
  }
  if (positional.length > 1) {
    return fail(
      'invalid-argument',
      `Line ${line}: "${directive}" takes one name, and "${positional.map((t) => t.text).join(' ')}" gives several.`,
    );
  }
  const name = positional[0]?.text ?? '';
  if (!name) return fail('invalid-argument', `Line ${line}: "${directive}" needs a name.`);
  return ok(name);
}

/** A three-component vector, failing with the key and the text that was written. */
function readVec(line: number, key: string, raw: string): Result<Vec3> {
  const parsed = parseVec3(raw);
  if (!parsed) {
    return fail('invalid-argument', `Line ${line}: "${key}=${raw}" is not three numbers.`);
  }
  return ok(parsed);
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

interface RawPart {
  name: string;
  kind: string;
  size: Vec3 | null;
  at: Vec3;
  rotation: Vec3;
  parent: string | null;
  material: string | null;
}

interface RawMaterial {
  name: string;
  material: SceneMaterial;
}

const PART_KEYS = ['kind', 'size', 'at', 'rotation', 'parent', 'mat'] as const;
const MATERIAL_KEYS = ['color', 'metal', 'rough', 'opacity'] as const;
const JOINT_KEYS = ['axis', 'range'] as const;

/** A 0..1 material parameter, refused rather than clamped. */
function readUnit(line: number, key: string, raw: string): Result<number> {
  const value = parseNumber(raw);
  if (value === null) {
    return fail('invalid-argument', `Line ${line}: "${key}=${raw}" is not a number.`);
  }
  if (value < 0 || value > 1) {
    return fail('invalid-argument', `Line ${line}: "${key}=${raw}" is outside 0..1.`);
  }
  return ok(value);
}

export function parseScene(source: string): Result<SceneGraph> {
  const lines = source.split(/\r?\n/);
  let sceneName: string | null = null;
  let unit: SceneGraph['unit'] = 'unit';
  const rawMaterials: RawMaterial[] = [];
  const rawParts: RawPart[] = [];
  const rawJoints: SceneJoint[] = [];
  let directives = 0;

  for (let index = 0; index < lines.length; index++) {
    const line = index + 1;
    const tokens = tokenise(lines[index] ?? '');
    if (!tokens) {
      return fail('invalid-argument', `Line ${line}: a quoted value is never closed.`);
    }
    if (tokens.length === 0) continue;

    const head = tokens[0];
    if (!head || head.quoted) {
      return fail('invalid-argument', `Line ${line}: a directive name is expected first.`);
    }
    const directive = head.text;
    const argv = tokens.slice(1);

    if (directive === 'scene') {
      if (directives > 0) {
        return fail('invalid-argument', `Line ${line}: "scene" must be the first directive, and it appears twice.`);
      }
      const fields = readFields(line, directive, argv, ['unit']);
      if (!fields.ok) return fields;
      const name = readName(line, directive, fields.value.positional);
      if (!name.ok) return name;
      sceneName = name.value;
      const declaredUnit = fields.value.keys.get('unit');
      if (declaredUnit !== undefined) {
        if (!SCENE_UNITS.includes(declaredUnit as SceneGraph['unit'])) {
          return fail(
            'invalid-argument',
            `Line ${line}: "unit=${declaredUnit}" is not a unit; use ${SCENE_UNITS.join(', ')}.`,
          );
        }
        unit = declaredUnit as SceneGraph['unit'];
      }
      directives += 1;
      continue;
    }

    if (directives === 0) {
      return fail(
        'invalid-argument',
        `Line ${line}: "${directive}" appears before the scene directive, which must come first.`,
      );
    }

    if (directive === 'material') {
      const fields = readFields(line, directive, argv, MATERIAL_KEYS);
      if (!fields.ok) return fields;
      const name = readName(line, directive, fields.value.positional);
      if (!name.ok) return name;
      if (rawMaterials.some((m) => m.name === name.value)) {
        return fail('invalid-argument', `Line ${line}: material "${name.value}" is declared twice.`);
      }
      const written = fields.value.keys.get('color');
      // An unresolvable colour is kept as written so `validateScene` can quote
      // it and the mesh can fall back to grey; substituting a plausible colour
      // here would hide the typo behind a scene that renders.
      const colour = written === undefined ? DEFAULT_MATERIAL.color : (normaliseColor(written) ?? written);
      const parameter = (key: string, fallback: number): Result<number> => {
        const raw = fields.value.keys.get(key);
        return raw === undefined ? ok(fallback) : readUnit(line, key, raw);
      };
      const metalness = parameter('metal', DEFAULT_MATERIAL.metalness);
      if (!metalness.ok) return metalness;
      const roughness = parameter('rough', DEFAULT_MATERIAL.roughness);
      if (!roughness.ok) return roughness;
      const alpha = parameter('opacity', DEFAULT_MATERIAL.opacity);
      if (!alpha.ok) return alpha;
      rawMaterials.push({
        name: name.value,
        material: {
          color: colour,
          metalness: metalness.value,
          roughness: roughness.value,
          opacity: alpha.value,
        },
      });
      directives += 1;
      continue;
    }

    if (directive === 'part') {
      const fields = readFields(line, directive, argv, PART_KEYS);
      if (!fields.ok) return fields;
      const name = readName(line, directive, fields.value.positional);
      if (!name.ok) return name;
      const kind = fields.value.keys.get('kind');
      if (kind === undefined) {
        return fail('invalid-argument', `Line ${line}: part "${name.value}" has no "kind".`);
      }
      const rawSize = fields.value.keys.get('size');
      let size: Vec3 | null = null;
      if (rawSize !== undefined) {
        const parsed = readVec(line, 'size', rawSize);
        if (!parsed.ok) return parsed;
        size = parsed.value;
      } else if (kind !== 'group') {
        return fail(
          'invalid-argument',
          `Line ${line}: part "${name.value}" of kind "${kind}" needs a size; a ${kind} size is ` +
            `${kind === 'sphere' ? '(radius, ignored, ignored)' : kind === 'box' ? '(width, height, depth)' : '(radius, height, ignored)'}.`,
        );
      }
      const atRaw = fields.value.keys.get('at');
      const at = atRaw === undefined ? ok<Vec3>([0, 0, 0]) : readVec(line, 'at', atRaw);
      if (!at.ok) return at;
      const rotationRaw = fields.value.keys.get('rotation');
      const rotation = rotationRaw === undefined ? ok<Vec3>([0, 0, 0]) : readVec(line, 'rotation', rotationRaw);
      if (!rotation.ok) return rotation;
      rawParts.push({
        name: name.value,
        kind,
        size,
        at: at.value,
        rotation: rotation.value,
        parent: fields.value.keys.get('parent') ?? null,
        material: fields.value.keys.get('mat') ?? null,
      });
      directives += 1;
      continue;
    }

    if (directive === 'joint') {
      const fields = readFields(line, directive, argv, JOINT_KEYS);
      if (!fields.ok) return fields;
      const positional = fields.value.positional;
      if (positional.length !== 2) {
        return fail('invalid-argument', `Line ${line}: "joint" takes a part name and a type.`);
      }
      const part = positional[0]?.text ?? '';
      const type = positional[1]?.text ?? '';
      if (type !== 'revolute' && type !== 'prismatic') {
        return fail(
          'invalid-argument',
          `Line ${line}: joint type "${type}" is neither "revolute" nor "prismatic".`,
        );
      }
      const axisRaw = fields.value.keys.get('axis');
      if (axisRaw === undefined) {
        return fail('invalid-argument', `Line ${line}: joint on "${part}" has no "axis".`);
      }
      const axis = readVec(line, 'axis', axisRaw);
      if (!axis.ok) return axis;
      const rangeRaw = fields.value.keys.get('range');
      if (rangeRaw === undefined) {
        return fail('invalid-argument', `Line ${line}: joint on "${part}" has no "range".`);
      }
      const range = parseNumberList(rangeRaw);
      if (!range || range.length !== 2) {
        return fail('invalid-argument', `Line ${line}: "range=${rangeRaw}" is not a minimum and a maximum.`);
      }
      rawJoints.push({
        part,
        type,
        axis: axis.value,
        min: range[0] ?? 0,
        max: range[1] ?? 0,
      });
      directives += 1;
      continue;
    }

    return fail('invalid-argument', `Line ${line}: "${directive}" is not a directive of this language.`);
  }

  if (sceneName === null) {
    return fail('invalid-argument', 'The program has no scene directive; a scene must open with one.');
  }

  /* ---------------------------------------------------------------- */
  /* Second pass: resolution, which is why declaration order is free   */
  /* ---------------------------------------------------------------- */

  const materials: Record<string, SceneMaterial> = {};
  for (const raw of rawMaterials) materials[raw.name] = raw.material;

  const parts: ScenePart[] = [];
  const byName = new Map<string, ScenePart>();
  for (const raw of rawParts) {
    /**
     * An unresolved material keeps a *copy* of DEFAULT_MATERIAL rather than
     * DEFAULT_MATERIAL itself. `ScenePart.material` is a material, not the name
     * that was asked for, so object identity is the only channel left for
     * "this part named a material that does not exist"; `validateScene` reads
     * it, and a part that simply omitted `mat` keeps the exported object and is
     * not flagged.
     */
    const named = raw.material === null ? null : materials[raw.material];
    const material = raw.material === null ? DEFAULT_MATERIAL : (named ?? { ...DEFAULT_MATERIAL });
    /**
     * The kind is kept verbatim even when nothing recognises it, so
     * `validateScene` can name it. The frozen contract's `kind` union has no
     * "other" member, so the unknown string travels in that field by cast.
     */
    const kind = raw.kind as ScenePrimitive;
    const part: ScenePart = {
      name: raw.name,
      kind,
      size: raw.size ?? [0, 0, 0],
      at: raw.at,
      rotation: raw.rotation,
      material,
      parent: raw.parent,
      depth: 0,
      children: [],
    };
    parts.push(part);
    if (!byName.has(part.name)) byName.set(part.name, part);
  }

  for (const part of parts) {
    if (part.parent === null) continue;
    const parent = byName.get(part.parent);
    if (parent) parent.children.push(part);
  }

  // Depth is computed by walking up with a visited set rather than by recursing
  // down from the roots, so a part whose parent chain loops still gets a finite
  // depth and the parse always terminates. `validateScene` reports the loop.
  for (const part of parts) {
    let depth = 0;
    const seen = new Set<ScenePart>([part]);
    let cursor = part.parent === null ? null : (byName.get(part.parent) ?? null);
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      depth += 1;
      cursor = cursor.parent === null ? null : (byName.get(cursor.parent) ?? null);
    }
    part.depth = depth;
  }

  // A part with a parent the scene never declares is still a root, so the tree
  // stays walkable while `validateScene` reports the dangling name.
  const roots = parts.filter((p) => p.parent === null || !byName.has(p.parent));

  return ok({ name: sceneName, unit, parts, roots, joints: rawJoints, materials });
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

function issue(code: SceneIssue['code'], message: string, part: string | null = null): SceneIssue {
  return { code, message, part };
}

/** The parent chain above `part` as a list of names, stopping at a repeat. */
function parentChain(part: ScenePart, byName: Map<string, ScenePart>): string[] {
  const chain: string[] = [];
  const seen = new Set<ScenePart>([part]);
  let cursor = part.parent === null ? null : (byName.get(part.parent) ?? null);
  while (cursor) {
    chain.push(cursor.name);
    if (seen.has(cursor)) return chain;
    seen.add(cursor);
    cursor = cursor.parent === null ? null : (byName.get(cursor.parent) ?? null);
  }
  return chain;
}

/** The size components a kind actually uses, with what each one is called. */
function usedDimensions(part: ScenePart): { label: string; value: number }[] {
  const [sx = 0, sy = 0, sz = 0] = part.size;
  switch (part.kind) {
    case 'box':
      return [
        { label: 'width', value: sx },
        { label: 'height', value: sy },
        { label: 'depth', value: sz },
      ];
    case 'cylinder':
    case 'cone':
      return [
        { label: 'radius', value: sx },
        { label: 'height', value: sy },
      ];
    case 'sphere':
      return [{ label: 'radius', value: sx }];
    case 'torus':
      return [
        { label: 'major radius', value: sx },
        { label: 'minor radius', value: sy },
      ];
    default:
      // `group` draws nothing, so it has no size to be degenerate.
      return [];
  }
}

export function validateScene(graph: SceneGraph): SceneIssue[] {
  const issues: SceneIssue[] = [];
  const byName = new Map<string, ScenePart>();
  for (const part of graph.parts) {
    if (!byName.has(part.name)) byName.set(part.name, part);
  }

  if (graph.parts.length === 0) {
    issues.push(issue('no-parts', 'The scene declares no parts, so there is nothing to compile.'));
  }

  const declaredMaterials = new Set<SceneMaterial>(Object.values(graph.materials));
  for (const [name, material] of Object.entries(graph.materials)) {
    if (normaliseColor(material.color) === null) {
      issues.push(
        issue('unknown-material', `Material "${name}" has colour "${material.color}", which is not a colour.`),
      );
    }
  }

  const seenNames = new Set<string>();
  for (const part of graph.parts) {
    if (seenNames.has(part.name)) {
      issues.push(issue('duplicate-part', `Part "${part.name}" is declared more than once.`, part.name));
    }
    seenNames.add(part.name);

    if (!SCENE_KINDS.includes(part.kind)) {
      issues.push(
        issue(
          'unknown-kind',
          `Part "${part.name}" is a "${part.kind}", which is none of ${SCENE_KINDS.join(', ')}.`,
          part.name,
        ),
      );
    }

    if (part.parent !== null && !byName.has(part.parent)) {
      issues.push(
        issue('unknown-parent', `Part "${part.name}" is parented to "${part.parent}", which is not a part.`, part.name),
      );
    }

    const chain = parentChain(part, byName);
    const repeated = new Set(chain).size !== chain.length || chain.includes(part.name);
    if (repeated) {
      issues.push(
        issue('cycle', `Part "${part.name}" is inside a parent loop: ${[part.name, ...chain].join(' -> ')}.`, part.name),
      );
    }

    if (part.material !== DEFAULT_MATERIAL && !declaredMaterials.has(part.material)) {
      issues.push(
        issue(
          'unknown-material',
          `Part "${part.name}" names a material this scene never declares, so it falls back to the default.`,
          part.name,
        ),
      );
    }

    for (const { label, value } of usedDimensions(part)) {
      if (!Number.isFinite(value) || value <= 0) {
        issues.push(
          issue(
            'degenerate-size',
            `Part "${part.name}" has a ${part.kind} ${label} of ${value}; every dimension it uses must be a positive, finite number.`,
            part.name,
          ),
        );
      }
    }
  }

  const jointed = new Set<string>();
  for (const joint of graph.joints) {
    const named = joint.part;
    if (!byName.has(named)) {
      issues.push(issue('unknown-part', `A joint names part "${named}", which is not a part of this scene.`, named));
      continue;
    }
    if (jointed.has(named)) {
      issues.push(
        issue(
          'bad-joint-range',
          `Part "${named}" already has a joint; a part articulates about one joint.`,
          named,
        ),
      );
      continue;
    }
    jointed.add(named);

    if (!Number.isFinite(joint.min) || !Number.isFinite(joint.max)) {
      issues.push(issue('bad-joint-range', `The joint on "${named}" has a bound that is not a number.`, named));
      continue;
    }
    if (joint.min >= joint.max) {
      issues.push(
        issue(
          'bad-joint-range',
          `The joint on "${named}" spans ${joint.min}..${joint.max}, and a minimum must be below its maximum.`,
          named,
        ),
      );
      continue;
    }
    if (normalize3(joint.axis) === null) {
      issues.push(
        issue('bad-joint-range', `The joint on "${named}" has a zero-length axis, so it has no direction.`, named),
      );
    }
  }

  return issues;
}

/* ------------------------------------------------------------------ */
/* Bounds                                                              */
/* ------------------------------------------------------------------ */

/**
 * Local bounds per kind, in the part's own space. `box` is the only kind that
 * uses all three size components; the rest ignore the ones their shape has no
 * room for, which is why the table in the language comment exists.
 */
function localBounds(part: ScenePart): Bounds | null {
  const [sx = 0, sy = 0, sz = 0] = part.size;
  switch (part.kind) {
    case 'box':
      return { min: [-sx / 2, -sy / 2, -sz / 2], max: [sx / 2, sy / 2, sz / 2] };
    case 'cylinder':
    case 'cone':
      // A cone's bounding box is the cylinder's: the base disc sets the extent.
      return { min: [-sx, -sy / 2, -sx], max: [sx, sy / 2, sx] };
    case 'sphere':
      return { min: [-sx, -sx, -sx], max: [sx, sx, sx] };
    case 'torus':
      return { min: [-(sx + sy), -sy, -(sx + sy)], max: [sx + sy, sy, sx + sy] };
    default:
      // A group draws nothing, and an unknown kind has no shape to measure; the
      // digest leaves their bounds to their descendants or omits them.
      return null;
  }
}

/**
 * An axis-aligned box under an arbitrary transform.
 *
 * All eight corners are transformed and the result re-bounded. Transforming
 * `min` and `max` alone is the classic shortcut and it is wrong the moment the
 * matrix rotates: for a 45 degree turn the two transformed corners are not the
 * extremes of the rotated box, and the reported bounds come out too small.
 */
function transformBounds(matrix: Mat4, local: Bounds): Bounds {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let corner = 0; corner < 8; corner++) {
    const point = transformPoint4(matrix, [
      (corner & 1) === 0 ? local.min[0] : local.max[0],
      (corner & 2) === 0 ? local.min[1] : local.max[1],
      (corner & 4) === 0 ? local.min[2] : local.max[2],
    ]);
    for (let axis = 0; axis < 3; axis++) {
      const value = point[axis] ?? 0;
      if (value < (min[axis] ?? Infinity)) min[axis] = value;
      if (value > (max[axis] ?? -Infinity)) max[axis] = value;
    }
  }
  return { min, max };
}

/**
 * World matrix per part: `parentWorld * compose4(at, rotation, (1,1,1))`.
 *
 * Resolved by walking up each part's chain and caching on the way back down, so
 * a child of a child costs one multiply rather than one per ancestor. The
 * visited set makes a looping chain terminate; such a graph is invalid and
 * `validateScene` says so, but the digest still has to return.
 */
function worldMatrices(graph: SceneGraph): Map<ScenePart, Mat4> {
  const byName = new Map<string, ScenePart>();
  for (const part of graph.parts) {
    if (!byName.has(part.name)) byName.set(part.name, part);
  }
  const resolved = new Map<ScenePart, Mat4>();
  const one: Vec3 = [1, 1, 1];

  for (const part of graph.parts) {
    if (resolved.has(part)) continue;
    const chain: ScenePart[] = [];
    const seen = new Set<ScenePart>();
    let cursor: ScenePart | null = part;
    while (cursor && !seen.has(cursor) && !resolved.has(cursor)) {
      seen.add(cursor);
      chain.push(cursor);
      cursor = cursor.parent === null ? null : (byName.get(cursor.parent) ?? null);
    }
    let matrix = cursor ? (resolved.get(cursor) ?? identity4()) : identity4();
    for (let i = chain.length - 1; i >= 0; i--) {
      const node = chain[i];
      if (!node) continue;
      matrix = multiply4(matrix, compose4(node.at, node.rotation, one));
      resolved.set(node, matrix);
    }
  }
  return resolved;
}

/** A part's own shape, in world space. Null for a group or an unknown kind. */
function ownBounds(part: ScenePart, worlds: Map<ScenePart, Mat4>): Bounds | null {
  const local = localBounds(part);
  if (!local) return null;
  const world = worlds.get(part);
  return world ? transformBounds(world, local) : null;
}

/** Every shape at or below `part`, unioned. Only a group needs this. */
function subtreeBounds(part: ScenePart, worlds: Map<ScenePart, Mat4>, seen: Set<ScenePart>): Bounds | null {
  let bounds = ownBounds(part, worlds);
  for (const child of part.children) {
    if (seen.has(child)) continue;
    seen.add(child);
    bounds = unionBounds(bounds, subtreeBounds(child, worlds, seen));
  }
  return bounds;
}

/**
 * The world bounds of one part.
 *
 * A part that draws something is exactly as big as what it draws, children
 * included — a post is a post, not a post plus the shade above it. A group has
 * no shape of its own, so its bounds are the union of *every* shape beneath it,
 * at any depth; a group with nothing beneath it has no bounds at all and is
 * left out of `partBounds` rather than given a zero box at the origin, which
 * would read as "there is something here".
 */
function boundsOf(part: ScenePart, worlds: Map<ScenePart, Mat4>, seen: Set<ScenePart>): Bounds | null {
  return ownBounds(part, worlds) ?? subtreeBounds(part, worlds, seen);
}

/** True when `ancestor` is strictly above `part` in the parent chain. */
function isAncestor(ancestor: ScenePart, part: ScenePart, byName: Map<string, ScenePart>): boolean {
  const seen = new Set<ScenePart>();
  let cursor = part.parent === null ? null : (byName.get(part.parent) ?? null);
  while (cursor) {
    if (cursor === ancestor) return true;
    if (seen.has(cursor)) return false;
    seen.add(cursor);
    cursor = cursor.parent === null ? null : (byName.get(cursor.parent) ?? null);
  }
  return false;
}

export function sceneDigest(graph: SceneGraph): SceneDigest {
  const worlds = worldMatrices(graph);
  const byName = new Map<string, ScenePart>();
  for (const part of graph.parts) {
    if (!byName.has(part.name)) byName.set(part.name, part);
  }

  const partBounds: Record<string, Bounds> = {};
  const boundsByPart = new Map<ScenePart, Bounds>();
  for (const part of graph.parts) {
    const bounds = boundsOf(part, worlds, new Set<ScenePart>([part]));
    if (!bounds) continue;
    boundsByPart.set(part, bounds);
    partBounds[part.name] = bounds;
  }

  /**
   * Bounding-box overlap, not a surface test. Two parts that are close but
   * shaped so they do not touch — the two arms of a U, say — can share an
   * axis-aligned box while sharing no volume at all, and this will report them.
   * It is the cheap check, and it is the one whose false positives a reviewer
   * can dismiss at a glance; a triangle-level test would be neither.
   *
   * Pairs where one part contains the other by parentage are left out: a parent
   * whose box holds its child's is the normal case, and reporting it would bury
   * the pairs that mean something.
   */
  const overlappingPairs: [string, string][] = [];
  const bounded = graph.parts.filter((part) => boundsByPart.has(part));
  for (let i = 0; i < bounded.length; i++) {
    const a = bounded[i];
    if (!a) continue;
    for (let j = i + 1; j < bounded.length; j++) {
      const b = bounded[j];
      if (!b) continue;
      if (isAncestor(a, b, byName) || isAncestor(b, a, byName)) continue;
      const boxA = boundsByPart.get(a);
      const boxB = boundsByPart.get(b);
      if (!boxA || !boxB) continue;
      if (intersectionVolume(boxA, boxB) > OVERLAP_TOLERANCE) overlappingPairs.push([a.name, b.name]);
    }
  }

  const kindCounts: Record<string, number> = {};
  for (const part of graph.parts) kindCounts[part.kind] = (kindCounts[part.kind] ?? 0) + 1;

  let worldBounds: Bounds | null = null;
  for (const bounds of boundsByPart.values()) worldBounds = unionBounds(worldBounds, bounds);

  let maxDepth = 0;
  for (const part of graph.parts) maxDepth = Math.max(maxDepth, part.depth);

  return {
    name: graph.name,
    unit: graph.unit,
    partNames: graph.parts.map((part) => part.name),
    kindCounts,
    partCount: graph.parts.length,
    maxDepth,
    rootCount: graph.roots.length,
    jointCount: graph.joints.length,
    worldBounds,
    partBounds,
    overlappingPairs,
    materials: { ...graph.materials },
  };
}

/* ------------------------------------------------------------------ */
/* Tessellation                                                        */
/* ------------------------------------------------------------------ */

/** Three local-space corners, wound counter-clockwise seen from outside. */
type Triangle = [Vec3, Vec3, Vec3];

type Tessellator = (size: Vec3) => Triangle[];

/** Emits a quad as two triangles, in the order its corners were given. */
function quad(out: Triangle[], corners: Vec3[]): void {
  const [a, b, c, d] = corners;
  if (!a || !b || !c || !d) return;
  out.push([a, b, c], [a, c, d]);
}

/** A ring of `segments` points at radius `radius` on the plane y = `y`. */
function ring(radius: number, y: number, segments: number): Vec3[] {
  const points: Vec3[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (2 * Math.PI * i) / segments;
    points.push([radius * Math.cos(angle), y, radius * Math.sin(angle)]);
  }
  return points;
}

function boxTriangles(size: Vec3): Triangle[] {
  const [sx = 0, sy = 0, sz = 0] = size;
  const x0 = -sx / 2;
  const x1 = sx / 2;
  const y0 = -sy / 2;
  const y1 = sy / 2;
  const z0 = -sz / 2;
  const z1 = sz / 2;
  const corner: Vec3[] = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y0, z1],
    [x1, y0, z1],
    [x1, y1, z1],
    [x0, y1, z1],
  ];
  // Each corner run is counter-clockwise as seen from outside the face, which
  // is what makes the winding-derived normal point out.
  const faces: [number, number, number, number][] = [
    [7, 6, 2, 3],
    [0, 1, 5, 4],
    [1, 2, 6, 5],
    [4, 7, 3, 0],
    [5, 6, 7, 4],
    [0, 3, 2, 1],
  ];
  const out: Triangle[] = [];
  for (const face of faces) {
    const corners = face.map((index) => corner[index]).filter((c): c is Vec3 => c !== undefined);
    quad(out, corners);
  }
  return out;
}

function cylinderTriangles(size: Vec3): Triangle[] {
  const [radius = 0, height = 0] = size;
  const segments = CYLINDER_SEGMENTS;
  const bottom = ring(radius, -height / 2, segments);
  const top = ring(radius, height / 2, segments);
  const lowCentre: Vec3 = [0, -height / 2, 0];
  const highCentre: Vec3 = [0, height / 2, 0];
  const out: Triangle[] = [];
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    const b0 = bottom[i];
    const b1 = bottom[j];
    const t0 = top[i];
    const t1 = top[j];
    if (!b0 || !b1 || !t0 || !t1) continue;
    quad(out, [b0, t0, t1, b1]);
    // The caps are fans, and the top one runs the other way round the ring: the
    // winding that faces outward on the lower cap faces inward on the upper one.
    out.push([lowCentre, b0, b1], [highCentre, t1, t0]);
  }
  return out;
}

function coneTriangles(size: Vec3): Triangle[] {
  const [radius = 0, height = 0] = size;
  const segments = CONE_SEGMENTS;
  const base = ring(radius, -height / 2, segments);
  const apex: Vec3 = [0, height / 2, 0];
  const centre: Vec3 = [0, -height / 2, 0];
  const out: Triangle[] = [];
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    const b0 = base[i];
    const b1 = base[j];
    if (!b0 || !b1) continue;
    out.push([b0, apex, b1], [centre, b0, b1]);
  }
  return out;
}

function sphereTriangles(size: Vec3): Triangle[] {
  const [radius = 0] = size;
  const rings = SPHERE_RINGS;
  const segments = SPHERE_SEGMENTS;
  const point = (ringIndex: number, segment: number): Vec3 => {
    const phi = -Math.PI / 2 + (Math.PI * ringIndex) / rings;
    const theta = (2 * Math.PI * segment) / segments;
    const rho = Math.cos(phi);
    return [radius * rho * Math.cos(theta), radius * Math.sin(phi), radius * rho * Math.sin(theta)];
  };
  const out: Triangle[] = [];
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < segments; i++) {
      // At either pole one triangle of the quad has two identical corners. It
      // is emitted anyway and dropped later by the zero-area test, which keeps
      // the winding rule the same everywhere.
      quad(out, [point(j, i), point(j + 1, i), point(j + 1, i + 1), point(j, i + 1)]);
    }
  }
  return out;
}

function torusTriangles(size: Vec3): Triangle[] {
  const [major = 0, minor = 0] = size;
  const majorSegments = TORUS_MAJOR_SEGMENTS;
  const minorSegments = TORUS_MINOR_SEGMENTS;
  const point = (i: number, k: number): Vec3 => {
    const theta = (2 * Math.PI * i) / majorSegments;
    const phi = (2 * Math.PI * k) / minorSegments;
    const rho = major + minor * Math.cos(phi);
    return [rho * Math.cos(theta), minor * Math.sin(phi), rho * Math.sin(theta)];
  };
  const out: Triangle[] = [];
  for (let i = 0; i < majorSegments; i++) {
    for (let k = 0; k < minorSegments; k++) {
      quad(out, [point(i, k), point(i, k + 1), point(i + 1, k + 1), point(i + 1, k)]);
    }
  }
  return out;
}

/**
 * The tessellator per kind, keyed by string rather than by `ScenePrimitive` so
 * that `group` and an unrecognised kind are simply absent: neither draws
 * anything, and a lookup miss is the whole of that decision.
 */
const TESSELLATORS: Record<string, Tessellator> = {
  box: boxTriangles,
  cylinder: cylinderTriangles,
  cone: coneTriangles,
  sphere: sphereTriangles,
  torus: torusTriangles,
};

/** The face normal of a wound triangle, or null when it has no area. */
function faceNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 | null {
  return normalize3(cross3(sub3(b, a), sub3(c, a)));
}

export function sceneToMesh(graph: SceneGraph): Mesh {
  const worlds = worldMatrices(graph);
  const positions: Vec3[] = [];
  const triangles: MeshTriangle[] = [];

  for (const part of graph.parts) {
    const tessellate = TESSELLATORS[part.kind];
    if (!tessellate) continue;
    const world = worlds.get(part);
    if (!world) continue;
    const colour = hexToRgb(part.material.color) ?? UNRESOLVED_RGB;

    for (const [localA, localB, localC] of tessellate(part.size)) {
      const a = transformPoint4(world, localA);
      const b = transformPoint4(world, localB);
      const c = transformPoint4(world, localC);
      // Recomputed from the transformed corners rather than carried over from
      // the local face: a normal is a direction, and a direction does not
      // survive a non-uniform scale the way a position does.
      const normal = faceNormal(a, b, c);
      if (!normal) continue;
      const base = positions.length;
      positions.push(a, b, c);
      triangles.push({
        a: base,
        b: base + 1,
        c: base + 2,
        normal,
        color: colour,
        opacity: part.material.opacity,
        part: part.name,
      });
    }
  }

  // A triangle soup: each triangle owns three fresh positions. Flat shading
  // means two triangles can share a vertex only where both the position and the
  // face normal agree, so sharing would save little on a faceted primitive and
  // would add a merge step whose failures are invisible in the output. The
  // `part` name on every triangle is what actually matters here, and it
  // survives the duplication untouched.
  return { positions, triangles };
}

/* ------------------------------------------------------------------ */
/* glTF                                                                */
/* ------------------------------------------------------------------ */

const GLB_MAGIC = 0x46546c67; // "glTF", little-endian
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const CHUNK_BIN = 0x004e4942; // "BIN\0"

/** glTF component types. */
const FLOAT = 5126;
const UNSIGNED_INT = 5125;

interface GltfAccessor {
  bufferView: number;
  byteOffset: number;
  componentType: number;
  count: number;
  type: 'VEC3' | 'SCALAR';
  min?: number[];
  max?: number[];
}

interface GltfBufferView {
  buffer: number;
  byteOffset: number;
  byteLength: number;
  target?: number;
}

interface GltfNode {
  name: string;
  translation: [number, number, number];
  rotation: [number, number, number, number];
  scale?: [number, number, number];
  mesh?: number;
  children?: number[];
}

interface GltfMaterial {
  name?: string;
  pbrMetallicRoughness: {
    baseColorFactor: [number, number, number, number];
    metallicFactor: number;
    roughnessFactor: number;
  };
  alphaMode?: 'BLEND';
}

/**
 * Euler degrees to the glTF quaternion, in the (x, y, z, w) order the format
 * wants. The angles are applied X, then Y, then Z, matching `rotationXYZ4` in
 * math.ts; writing the closed form rather than reading it back out of the
 * matrix avoids a trip through float arithmetic that would leave the two
 * disagreeing in the last bits.
 */
function quaternionFromEuler(rotation: Vec3): [number, number, number, number] {
  const half = (degrees: number) => (degrees * Math.PI) / 360;
  const [x = 0, y = 0, z = 0] = rotation;
  const cx = Math.cos(half(x));
  const sx = Math.sin(half(x));
  const cy = Math.cos(half(y));
  const sy = Math.sin(half(y));
  const cz = Math.cos(half(z));
  const sz = Math.sin(half(z));
  return [
    sx * cy * cz - cx * sy * sz,
    cx * sy * cz + sx * cy * sz,
    cx * cy * sz - sx * sy * cz,
    cx * cy * cz + sx * sy * sz,
  ];
}

/** Four-byte alignment, which is what every accessor here needs. */
function align4(value: number): number {
  return value + ((4 - (value % 4)) % 4);
}

interface PartGeometry {
  part: ScenePart;
  /** Tightly interleaved-by-vertex xyz triples, three vertices per triangle. */
  positions: number[];
  normals: number[];
  indices: number[];
  min: Vec3;
  max: Vec3;
}

/**
 * One part's triangles in the part's own space, ready to be written.
 *
 * These are *local*, not world space, because the node that carries this mesh
 * also carries the part's `at` and `rotation`. Writing world-space vertices
 * under a node that applies the local transform again would place the part
 * twice as far out as it belongs. `sceneToMesh` is where world space is
 * produced, for the rasteriser, which has no node tree to lean on.
 */
function partGeometry(part: ScenePart): PartGeometry | null {
  const tessellate = TESSELLATORS[part.kind];
  if (!tessellate) return null;

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];

  for (const [a, b, c] of tessellate(part.size)) {
    const normal = faceNormal(a, b, c);
    if (!normal) continue;
    const base = positions.length / 3;
    for (const corner of [a, b, c]) {
      // Recorded as 32-bit because that is what the accessor stores; a min
      // computed in 64-bit can sit one bit away from every value in the buffer.
      const stored: Vec3 = [Math.fround(corner[0]), Math.fround(corner[1]), Math.fround(corner[2])];
      positions.push(stored[0], stored[1], stored[2]);
      normals.push(normal[0], normal[1], normal[2]);
      for (let axis = 0; axis < 3; axis++) {
        const value = stored[axis] ?? 0;
        if (value < (min[axis] ?? Infinity)) min[axis] = value;
        if (value > (max[axis] ?? -Infinity)) max[axis] = value;
      }
    }
    indices.push(base, base + 1, base + 2);
  }

  if (indices.length === 0) return null;
  return { part, positions, normals, indices, min, max };
}

export function sceneToGlb(graph: SceneGraph): Result<Uint8Array> {
  const issues = validateScene(graph);
  if (issues.length > 0) {
    const first = issues[0];
    return fail(
      'invalid-argument',
      `The scene has ${issues.length} issue${issues.length === 1 ? '' : 's'} and was not compiled: ${first?.message ?? ''}`,
    );
  }

  const geometries: PartGeometry[] = [];
  for (const part of graph.parts) {
    const geometry = partGeometry(part);
    if (geometry) geometries.push(geometry);
  }

  /**
   * Materials in declaration order, then the default if any part fell back to
   * it, so every mesh can point at an index that exists. Identity is the key:
   * two materials with the same values but different names stay two entries.
   */
  const materialList: { material: SceneMaterial; name: string | null }[] = [];
  for (const [name, material] of Object.entries(graph.materials)) {
    materialList.push({ material, name });
  }
  const materialIndex = (material: SceneMaterial): number => {
    const found = materialList.findIndex((entry) => entry.material === material);
    if (found >= 0) return found;
    // A fallback material has no name in the scene, and inventing one would be
    // a name a reviewer could not find in the source.
    materialList.push({ material, name: null });
    return materialList.length - 1;
  };

  const accessors: GltfAccessor[] = [];
  const bufferViews: GltfBufferView[] = [];
  const meshes: { name: string; primitives: unknown[] }[] = [];
  const meshIndexByPart = new Map<ScenePart, number>();

  /**
   * The buffer is laid out in one pass and written in another, with a running
   * offset. Every accessor element here is four bytes, so each block is already
   * a multiple of four and `align4` never actually moves the cursor; it is kept
   * because the alignment rule is a property of the accessors, not of today's
   * choice to index with 32-bit integers.
   */
  let binLength = 0;
  const layout = geometries.map((geometry) => {
    const positionOffset = align4(binLength);
    const normalOffset = align4(positionOffset + geometry.positions.length * 4);
    const indexOffset = align4(normalOffset + geometry.normals.length * 4);
    binLength = indexOffset + geometry.indices.length * 4;
    return { geometry, positionOffset, normalOffset, indexOffset };
  });

  const bin = new Uint8Array(align4(binLength));
  const view = new DataView(bin.buffer);
  for (const entry of layout) {
    const { geometry } = entry;
    const positionView = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: entry.positionOffset, byteLength: geometry.positions.length * 4 });
    const normalView = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: entry.normalOffset, byteLength: geometry.normals.length * 4 });
    const indexView = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: entry.indexOffset, byteLength: geometry.indices.length * 4 });

    geometry.positions.forEach((value, i) => view.setFloat32(entry.positionOffset + i * 4, value, true));
    geometry.normals.forEach((value, i) => view.setFloat32(entry.normalOffset + i * 4, value, true));
    geometry.indices.forEach((value, i) => view.setUint32(entry.indexOffset + i * 4, value, true));

    const positionAccessor = accessors.length;
    accessors.push({
      bufferView: positionView,
      byteOffset: 0,
      componentType: FLOAT,
      count: geometry.positions.length / 3,
      type: 'VEC3',
      min: [geometry.min[0], geometry.min[1], geometry.min[2]],
      max: [geometry.max[0], geometry.max[1], geometry.max[2]],
    });
    const normalAccessor = accessors.length;
    accessors.push({
      bufferView: normalView,
      byteOffset: 0,
      componentType: FLOAT,
      count: geometry.normals.length / 3,
      type: 'VEC3',
    });
    const indexAccessor = accessors.length;
    accessors.push({
      bufferView: indexView,
      byteOffset: 0,
      componentType: UNSIGNED_INT,
      count: geometry.indices.length,
      type: 'SCALAR',
    });

    meshIndexByPart.set(geometry.part, meshes.length);
    meshes.push({
      name: `${geometry.part.name}Mesh`,
      primitives: [
        {
          attributes: { POSITION: positionAccessor, NORMAL: normalAccessor },
          indices: indexAccessor,
          material: materialIndex(geometry.part.material),
          mode: 4,
        },
      ],
    });
  }

  const nodes: GltfNode[] = graph.parts.map((part) => {
    const node: GltfNode = {
      name: part.name,
      translation: [part.at[0], part.at[1], part.at[2]],
      rotation: quaternionFromEuler(part.rotation),
    };
    const mesh = meshIndexByPart.get(part);
    if (mesh !== undefined) node.mesh = mesh;
    if (part.children.length > 0) node.children = part.children.map((child) => graph.parts.indexOf(child));
    return node;
  });

  // The unit belongs on the nodes with no ancestor, and only there: glTF is
  // metres, and a scale repeated on every node would compound down the tree.
  const scale = UNIT_SCALE[graph.unit];
  if (scale !== 1) {
    for (const root of graph.roots) {
      const node = nodes[graph.parts.indexOf(root)];
      if (node) node.scale = [scale, scale, scale];
    }
  }

  const materials: GltfMaterial[] = materialList.map(({ material, name }) => {
    const rgb = hexToRgb(material.color) ?? UNRESOLVED_RGB;
    const entry: GltfMaterial = {
      pbrMetallicRoughness: {
        // Straight 0..1 from the authored 0..255. No sRGB-to-linear conversion:
        // the colour in the file is the colour in the source, and a conversion
        // here would make the compiled artifact disagree with the thing a
        // reviewer edits.
        baseColorFactor: [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, material.opacity],
        metallicFactor: material.metalness,
        roughnessFactor: material.roughness,
      },
    };
    if (name !== null) entry.name = name;
    if (material.opacity < 1) entry.alphaMode = 'BLEND';
    return entry;
  });

  const gltf = {
    asset: { version: '2.0', generator: 'anascummis design harness' },
    scene: 0,
    scenes: [{ name: graph.name, nodes: graph.roots.map((root) => graph.parts.indexOf(root)) }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binLength }],
  };

  return ok(writeGlb(gltf, bin));
}

/**
 * Packs JSON and BIN into the GLB container.
 *
 * Written with a `DataView` at a running offset rather than by concatenating
 * arrays: the header stores the total length and each chunk stores its own, and
 * a length that disagrees with the bytes that follow is the failure mode that
 * makes a reader refuse the whole file. Offsets, for the record: the header is
 * 12 bytes, each chunk header 8, so the JSON chunk starts at 12 and the BIN
 * chunk starts at 12 + 8 + jsonChunkLength.
 */
function writeGlb(gltf: unknown, bin: Uint8Array): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(gltf));
  // Both chunks must be a multiple of four: JSON is padded with spaces, which
  // are legal trailing whitespace, and BIN with zeros.
  const jsonPadded = align4(json.length);
  const binPadded = align4(bin.length);
  const total = 12 + 8 + jsonPadded + 8 + binPadded;

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);

  const jsonStart = 12;
  view.setUint32(jsonStart, jsonPadded, true);
  view.setUint32(jsonStart + 4, CHUNK_JSON, true);
  out.set(json, jsonStart + 8);
  out.fill(0x20, jsonStart + 8 + json.length, jsonStart + 8 + jsonPadded);

  const binStart = jsonStart + 8 + jsonPadded;
  view.setUint32(binStart, binPadded, true);
  view.setUint32(binStart + 4, CHUNK_BIN, true);
  out.set(bin, binStart + 8);

  return out;
}

/* ------------------------------------------------------------------ */
/* The example                                                         */
/* ------------------------------------------------------------------ */

/**
 * A short, valid program with comments, used by the tests and worth reading as
 * the specification of the language. It has one root group so the lamp moves as
 * one object, one material used by every part, and one joint so the shade can
 * be aimed.
 */
export const SCENE_SOURCE_EXAMPLE: string = `# A table lamp, authored as source. All lengths are metres.
# A part's "at" is its centre in its parent's space, not its base.

scene "table-lamp" unit=m

# Brushed brass, used by every part below.
material brass color=#b08d57 metal=0.8 rough=0.3 opacity=1

# The root. A group draws nothing; it exists so the lamp is one object.
part lamp kind=group

part base  kind=cylinder size=0.12,0.02,0.12 at=0,0.01,0  parent=lamp mat=brass
part post  kind=cylinder size=0.02,0.45,0.02 at=0,0.24,0  parent=base mat=brass
part shade kind=cone     size=0.18,0.16,0.18 at=0,0.56,0  parent=post mat=brass

# The shade tilts about X, so the lamp can be aimed.
joint shade revolute axis=1,0,0 range=-25,25
`;
