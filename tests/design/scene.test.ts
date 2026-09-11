import { describe, expect, it } from 'vitest';
import {
  SCENE_SOURCE_EXAMPLE,
  parseScene,
  sceneDigest,
  sceneToGlb,
  sceneToMesh,
  validateScene,
} from '@worker/design/scene';
import type { Bounds, SceneDigest, SceneGraph, SceneIssue } from '@worker/design/types';

/**
 * The compiled half of the scene surface. Everything here is a pure function of
 * the source text, so the tests are exact rather than approximate: a rotated
 * child's world box is compared against the value worked out by hand, and the
 * glTF accessor bounds are compared against the floats actually written into
 * the buffer rather than against a second computation of the same thing.
 *
 * The cases that matter most are the ones where a plausible implementation is
 * wrong: transforming a box's min and max instead of its eight corners, letting
 * a parent's box and its child's count as an overlap, and a parent chain that
 * loops — which must be reported rather than followed.
 */

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function build(source: string): SceneGraph {
  const parsed = parseScene(source);
  if (!parsed.ok) throw new Error(`expected a parse, got: ${parsed.message}`);
  return parsed.value;
}

function issuesFor(source: string): SceneIssue[] {
  return validateScene(build(source));
}

function digestOf(source: string): SceneDigest {
  return sceneDigest(build(source));
}

function codesFor(source: string): string[] {
  return issuesFor(source).map((issue) => issue.code);
}

/** Float comparison with enough digits to catch a wrong transform, not just a wild one. */
function expectVec(actual: readonly number[] | undefined, expected: readonly number[]): void {
  expect(actual).toBeDefined();
  expected.forEach((value, axis) => expect(actual?.[axis] ?? Number.NaN).toBeCloseTo(value, 6));
}

const min = (bounds: Bounds | undefined): number[] | undefined => bounds?.min;
const max = (bounds: Bounds | undefined): number[] | undefined => bounds?.max;

/* ------------------------------------------------------------------ */
/* The container                                                       */
/* ------------------------------------------------------------------ */

interface GltfJson {
  asset: { version: string; generator?: string };
  scene: number;
  scenes: { name?: string; nodes: number[] }[];
  nodes: {
    name: string;
    translation?: number[];
    rotation?: number[];
    scale?: number[];
    mesh?: number;
    children?: number[];
  }[];
  meshes: {
    name?: string;
    primitives: {
      attributes: { POSITION: number; NORMAL: number };
      indices: number;
      material?: number;
      mode?: number;
    }[];
  }[];
  materials: {
    name?: string;
    pbrMetallicRoughness: { baseColorFactor: number[]; metallicFactor: number; roughnessFactor: number };
    alphaMode?: string;
  }[];
  accessors: {
    bufferView?: number;
    byteOffset?: number;
    componentType: number;
    count: number;
    type: string;
    min?: number[];
    max?: number[];
  }[];
  bufferViews: { buffer: number; byteOffset?: number; byteLength: number }[];
  buffers: { byteLength: number; uri?: string }[];
}

interface Glb {
  bytes: Uint8Array;
  json: GltfJson;
  bin: Uint8Array;
  jsonChunkLength: number;
}

function glbFor(source: string): Glb {
  const compiled = sceneToGlb(build(source));
  if (!compiled.ok) throw new Error(`expected a GLB, got: ${compiled.message}`);
  const bytes = compiled.value;
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonChunkLength = header.getUint32(12, true);
  const json = JSON.parse(
    new TextDecoder().decode(bytes.subarray(20, 20 + jsonChunkLength)),
  ) as GltfJson;
  const binStart = 20 + jsonChunkLength;
  const binLength = header.getUint32(binStart, true);
  const bin = bytes.subarray(binStart + 8, binStart + 8 + binLength);
  return { bytes, json, bin, jsonChunkLength };
}

/** The floats behind a VEC3 accessor, read back out of the BIN chunk. */
function readVec3(glb: Glb, accessorIndex: number): number[][] {
  const accessor = glb.json.accessors[accessorIndex];
  if (!accessor) throw new Error(`no accessor ${accessorIndex}`);
  const bufferView = accessor.bufferView === undefined ? undefined : glb.json.bufferViews[accessor.bufferView];
  if (!bufferView) throw new Error(`no bufferView for accessor ${accessorIndex}`);
  const view = new DataView(glb.bin.buffer, glb.bin.byteOffset, glb.bin.byteLength);
  const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const out: number[][] = [];
  for (let i = 0; i < accessor.count; i++) {
    out.push([
      view.getFloat32(start + i * 12, true),
      view.getFloat32(start + i * 12 + 4, true),
      view.getFloat32(start + i * 12 + 8, true),
    ]);
  }
  return out;
}

/** The slice of the buffer an accessor points at, as raw bytes. */
function readBytes(glb: Glb, accessorIndex: number): Uint8Array {
  const accessor = glb.json.accessors[accessorIndex];
  if (!accessor) throw new Error(`no accessor ${accessorIndex}`);
  const bufferView = accessor.bufferView === undefined ? undefined : glb.json.bufferViews[accessor.bufferView];
  if (!bufferView) throw new Error(`no bufferView for accessor ${accessorIndex}`);
  const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  return glb.bin.subarray(start, start + bufferView.byteLength);
}

/* ------------------------------------------------------------------ */
/* The example program                                                 */
/* ------------------------------------------------------------------ */

describe('the example program', () => {
  it('parses and validates clean, which is what the example is for', () => {
    const parsed = parseScene(SCENE_SOURCE_EXAMPLE);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.name).toBe('table-lamp');
    expect(parsed.value.unit).toBe('m');
    expect(validateScene(parsed.value)).toEqual([]);
  });

  it('reads the tree out of the parent names', () => {
    const graph = build(SCENE_SOURCE_EXAMPLE);
    expect(graph.parts.map((part) => part.name)).toEqual(['lamp', 'base', 'post', 'shade']);
    expect(graph.roots.map((part) => part.name)).toEqual(['lamp']);
    expect(graph.parts.map((part) => part.depth)).toEqual([0, 1, 2, 3]);
    expect(graph.parts[1]?.children.map((child) => child.name)).toEqual(['post']);
    expect(graph.joints[0]?.part).toBe('shade');
    expect(graph.joints[0]?.type).toBe('revolute');
  });

  it('digests names, kinds and counts', () => {
    const digest = sceneDigest(build(SCENE_SOURCE_EXAMPLE));
    expect(digest.partNames).toEqual(['lamp', 'base', 'post', 'shade']);
    expect(digest.kindCounts).toEqual({ group: 1, cylinder: 2, cone: 1 });
    expect(digest.partCount).toBe(4);
    expect(digest.maxDepth).toBe(3);
    expect(digest.rootCount).toBe(1);
    expect(digest.jointCount).toBe(1);
    expect(Object.keys(digest.materials)).toEqual(['brass']);
    expect(digest.materials.brass?.color).toBe('#b08d57');
    expect(digest.materials.brass?.metalness).toBe(0.8);
    expect(digest.materials.brass?.roughness).toBe(0.3);
  });

  it('places every part where the transforms say, group included', () => {
    const digest = sceneDigest(build(SCENE_SOURCE_EXAMPLE));
    expectVec(min(digest.partBounds.base), [-0.12, 0, -0.12]);
    expectVec(max(digest.partBounds.base), [0.12, 0.02, 0.12]);
    expectVec(min(digest.partBounds.post), [-0.02, 0.025, -0.02]);
    expectVec(max(digest.partBounds.post), [0.02, 0.475, 0.02]);
    expectVec(min(digest.partBounds.shade), [-0.18, 0.73, -0.18]);
    expectVec(max(digest.partBounds.shade), [0.18, 0.89, 0.18]);
    // The group draws nothing, so it is exactly as big as everything beneath it.
    expectVec(min(digest.partBounds.lamp), [-0.18, 0, -0.18]);
    expectVec(max(digest.partBounds.lamp), [0.18, 0.89, 0.18]);
    expectVec(min(digest.worldBounds ?? undefined), [-0.18, 0, -0.18]);
    expectVec(max(digest.worldBounds ?? undefined), [0.18, 0.89, 0.18]);
  });

  it('reports no overlap for a lamp whose parts are parented to one another', () => {
    expect(sceneDigest(build(SCENE_SOURCE_EXAMPLE)).overlappingPairs).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Placement                                                           */
/* ------------------------------------------------------------------ */

describe('placement', () => {
  const parentMoved = (y: number): string => `scene s
part parent kind=box size=1,1,1 at=0,${y},0
part child kind=box size=1,2,1 at=2,0,0 parent=parent`;

  it('moves a child world box with its parent, and leaves the child local box alone', () => {
    const before = digestOf(parentMoved(0));
    const after = digestOf(parentMoved(10));
    const childBefore = before.partBounds.child;
    const childAfter = after.partBounds.child;
    expectVec(min(childBefore), [1.5, -1, -0.5]);
    expectVec(max(childBefore), [2.5, 1, 0.5]);
    // Only the y of the world box moves, and by exactly the parent's shift.
    expectVec(min(childAfter), [1.5, 9, -0.5]);
    expectVec(max(childAfter), [2.5, 11, 0.5]);
    // The child's own size and offset are untouched: local needs no recomputing.
    const child = build(parentMoved(10)).parts[1];
    expect(child?.size).toEqual([1, 2, 1]);
    expect(child?.at).toEqual([2, 0, 0]);
  });

  it('carries a 90 degree Z rotation through to the child, corner for corner', () => {
    // Rotating the parent by +90 about Z maps (x, y) to (-y, x). The child box
    // occupies x in [1.5, 2.5], y in [-1, 1] in the parent's space, so it lands
    // at x in [-1, 1], y in [1.5, 2.5]. An implementation that transformed only
    // the min and max corners would report the corner runs swapped.
    const digest = digestOf(`scene s
part parent kind=box size=1,1,1 rotation=0,0,90
part child kind=box size=1,2,1 at=2,0,0 parent=parent`);
    expectVec(min(digest.partBounds.child), [-1, 1.5, -0.5]);
    expectVec(max(digest.partBounds.child), [1, 2.5, 0.5]);
    expectVec(min(digest.partBounds.parent), [-0.5, -0.5, -0.5]);
    expectVec(max(digest.partBounds.parent), [0.5, 0.5, 0.5]);
  });

  it('bounds a 45 degree turn by its corners, not by its endpoints', () => {
    // At 45 degrees the two transformed corners are *inside* the rotated box,
    // so min/max-only gives x in [1.06, 1.77] where the answer is
    // [0.354, 2.475]: 2.475 = (2.5 + 1) / sqrt(2).
    const digest = digestOf(`scene s
part parent kind=box size=1,1,1 rotation=0,0,45
part child kind=box size=1,2,1 at=2,0,0 parent=parent`);
    const corner = (2.5 + 1) * Math.SQRT1_2;
    expectVec(min(digest.partBounds.child), [0.5 * Math.SQRT1_2, 0.5 * Math.SQRT1_2, -0.5]);
    expectVec(max(digest.partBounds.child), [corner, corner, 0.5]);
  });

  it('keeps a part at its declared centre, not its base', () => {
    const digest = digestOf('scene s\npart a kind=box size=2,4,6 at=10,20,30');
    expectVec(min(digest.partBounds.a), [9, 18, 27]);
    expectVec(max(digest.partBounds.a), [11, 22, 33]);
  });

  it('measures each kind the way its size table says', () => {
    const digest = digestOf(`scene s
part box kind=box size=2,4,6
part cylinder kind=cylinder size=1,2,99
part cone kind=cone size=1,2,99
part sphere kind=sphere size=3,99,99
part torus kind=torus size=4,1,99`);
    expectVec(min(digest.partBounds.cylinder), [-1, -1, -1]);
    expectVec(max(digest.partBounds.cylinder), [1, 1, 1]);
    // A cone's box is the cylinder's: the base disc sets the extent.
    expectVec(min(digest.partBounds.cone), [-1, -1, -1]);
    expectVec(max(digest.partBounds.cone), [1, 1, 1]);
    expectVec(min(digest.partBounds.sphere), [-3, -3, -3]);
    expectVec(min(digest.partBounds.torus), [-5, -1, -5]);
    expectVec(max(digest.partBounds.torus), [5, 1, 5]);
  });
});

/* ------------------------------------------------------------------ */
/* Overlap                                                             */
/* ------------------------------------------------------------------ */

describe('overlapping pairs', () => {
  const scene = `scene s
part outer kind=box size=2,2,2 at=0,0,0
part inner kind=box size=0.5,0.5,0.5 parent=outer
part left  kind=box size=1,1,1 at=0,2,0
part right kind=box size=1,1,1 at=0.5,2,0
part far   kind=box size=1,1,1 at=9,0,0`;

  it('reports two intersecting siblings once', () => {
    const pairs = digestOf(scene).overlappingPairs;
    expect(pairs).toEqual([['left', 'right']]);
  });

  it('does not report a parent whose box holds its child', () => {
    const pairs = digestOf(scene).overlappingPairs;
    expect(pairs.some(([a, b]) => a === 'outer' || b === 'outer')).toBe(false);
  });

  it('does not report parts that only share a plane', () => {
    // `left` and `right` touch at their faces in one axis only after this move,
    // so nothing intersects by volume.
    const pairs = digestOf(`scene s
part a kind=box size=1,1,1 at=0,0,0
part b kind=box size=1,1,1 at=1,0,0`).overlappingPairs;
    expect(pairs).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Issues                                                              */
/* ------------------------------------------------------------------ */

describe('issues', () => {
  it('names a parent that does not exist and keeps the part walkable', () => {
    const graph = build('scene s\npart post kind=box size=1,1,1 parent=basee');
    const issues = validateScene(graph);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('unknown-parent');
    expect(issues[0]?.part).toBe('post');
    expect(issues[0]?.message).toContain('basee');
    // Still listed, and still a root, so a reviewer can see where it landed.
    expect(graph.parts.map((part) => part.name)).toEqual(['post']);
    expect(graph.roots.map((part) => part.name)).toEqual(['post']);
  });

  it('reports a duplicate name once per repeat', () => {
    expect(codesFor('scene s\npart a kind=box size=1,1,1\npart a kind=box size=2,2,2')).toEqual([
      'duplicate-part',
    ]);
  });

  it('reports a parent loop, and terminates doing it', () => {
    const issues = issuesFor('scene s\npart a kind=box size=1,1,1 parent=b\npart b kind=box size=1,1,1 parent=a');
    expect(issues.map((issue) => issue.code)).toEqual(['cycle', 'cycle']);
    expect(issues[0]?.message).toContain('a -> b -> a');
    // A loop has no root, so the walk from the roots never reaches it; the
    // digest still has to return rather than recurse for ever.
    const digest = digestOf('scene s\npart a kind=box size=1,1,1 parent=b\npart b kind=box size=1,1,1 parent=a');
    expect(digest.rootCount).toBe(0);
    expect(digest.partCount).toBe(2);
  });

  it('reports a part that is its own parent', () => {
    expect(codesFor('scene s\npart a kind=box size=1,1,1 parent=a')).toEqual(['cycle']);
  });

  it('reports a colour it cannot resolve rather than defaulting it', () => {
    const issues = issuesFor('scene s\nmaterial m color=notacolour\npart a kind=box size=1,1,1 mat=m');
    expect(issues.map((issue) => issue.code)).toEqual(['unknown-material']);
    expect(issues[0]?.message).toContain('notacolour');
  });

  it('reports a part that names a material the scene never declares', () => {
    const issues = issuesFor('scene s\npart a kind=box size=1,1,1 mat=ghost');
    expect(issues.map((issue) => issue.code)).toEqual(['unknown-material']);
    expect(issues[0]?.part).toBe('a');
  });

  it('resolves a material declared after the part that uses it', () => {
    expect(codesFor('scene s\npart a kind=box size=1,1,1 mat=brass\nmaterial brass color=red')).toEqual([]);
  });

  it('reports a joint that names nothing, a range that runs backwards, a zero axis', () => {
    expect(codesFor('scene s\npart a kind=box size=1,1,1\njoint zap revolute axis=1,0,0 range=-1,1')).toEqual([
      'unknown-part',
    ]);
    expect(codesFor('scene s\npart a kind=box size=1,1,1\njoint a revolute axis=1,0,0 range=10,10')).toEqual([
      'bad-joint-range',
    ]);
    expect(codesFor('scene s\npart a kind=box size=1,1,1\njoint a revolute axis=0,0,0 range=-1,1')).toEqual([
      'bad-joint-range',
    ]);
  });

  it('refuses a second joint on one part', () => {
    const issues = issuesFor(`scene s
part a kind=box size=1,1,1
joint a revolute axis=1,0,0 range=-1,1
joint a prismatic axis=0,1,0 range=-1,1`);
    expect(issues.map((issue) => issue.code)).toEqual(['bad-joint-range']);
    expect(issues[0]?.message).toContain('one joint');
  });

  it('reports an unknown kind, a degenerate size and an empty scene', () => {
    expect(codesFor('scene s\npart a kind=blob size=1,1,1')).toEqual(['unknown-kind']);
    expect(codesFor('scene s\npart a kind=cylinder size=0,1,0')).toEqual(['degenerate-size']);
    expect(codesFor('scene s\npart a kind=sphere size=-2,0,0')).toEqual(['degenerate-size']);
    expect(codesFor('scene s')).toEqual(['no-parts']);
  });

  it('only measures the size components a kind uses', () => {
    // The third component of a cylinder is ignored, so a zero there is not a
    // degenerate part — it is a number nothing reads.
    expect(codesFor('scene s\npart a kind=cylinder size=1,1,0')).toEqual([]);
    // A group is a container, so it needs no size at all.
    expect(codesFor('scene s\npart g kind=group')).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Syntax                                                              */
/* ------------------------------------------------------------------ */

describe('the parser', () => {
  const refusal = (source: string): string => {
    const parsed = parseScene(source);
    if (parsed.ok) throw new Error('expected a refusal');
    expect(parsed.kind).toBe('invalid-argument');
    return parsed.message;
  };

  it('needs a scene directive first, and only one', () => {
    expect(refusal('# nothing but a comment\n')).toContain('no scene directive');
    expect(refusal('part a kind=box size=1,1,1')).toContain('before the scene directive');
    expect(refusal('material m color=red\nscene s')).toContain('before the scene directive');
    expect(refusal('scene s\nscene t')).toContain('appears twice');
  });

  it('refuses a key a directive does not take, and quotes the line', () => {
    const message = refusal('scene s\npart base kind=box size=1,1,1 parnet=other');
    expect(message).toContain('Line 2');
    expect(message).toContain('parnet');
  });

  it('refuses an unknown directive and an unknown unit', () => {
    expect(refusal('scene s\nwidget a kind=box')).toContain('not a directive');
    expect(refusal('scene s unit=furlong')).toContain('is not a unit');
  });

  it('refuses a value it cannot read, and a size a kind cannot do without', () => {
    expect(refusal('scene s\npart a kind=box size=1,2')).toContain('not three numbers');
    expect(refusal('scene s\npart a kind=box')).toContain('needs a size');
    expect(refusal('scene s\npart a kind=box size=1,1,1 at=here')).toContain('not three numbers');
    expect(refusal('scene s\nmaterial m color=red metal=2')).toContain('outside 0..1');
    expect(refusal('scene s\npart a kind=box size=1,1,1\njoint a revolute axis=1,0,0')).toContain('no "range"');
  });

  it('reads quoted names, and does not mistake a colour for a comment', () => {
    const graph = build('scene "table lamp" # a note\nmaterial brass color=#b08d57\npart "the base" kind=box size=1,1,1 mat=brass');
    expect(graph.name).toBe('table lamp');
    expect(graph.parts[0]?.name).toBe('the base');
    expect(graph.materials.brass?.color).toBe('#b08d57');
  });

  it('refuses an unterminated quote', () => {
    expect(refusal('scene "table lamp\npart a kind=box size=1,1,1')).toContain('never closed');
  });
});

/* ------------------------------------------------------------------ */
/* The mesh                                                            */
/* ------------------------------------------------------------------ */

describe('the mesh', () => {
  it('names the part on every triangle and draws nothing for a group', () => {
    const graph = build(SCENE_SOURCE_EXAMPLE);
    const mesh = sceneToMesh(graph);
    expect(new Set(mesh.triangles.map((triangle) => triangle.part))).toEqual(
      new Set(['base', 'post', 'shade']),
    );
    expect(mesh.triangles.length).toBeGreaterThan(0);
    expect(mesh.positions.length).toBe(mesh.triangles.length * 3);
  });

  it('gives every triangle a unit normal', () => {
    const mesh = sceneToMesh(build(SCENE_SOURCE_EXAMPLE));
    for (const triangle of mesh.triangles) {
      expect(Math.hypot(...triangle.normal)).toBeCloseTo(1, 9);
    }
  });

  it('carries the material colour and opacity onto the triangles', () => {
    const [red, brass] = [
      build('scene s\nmaterial m color=#ff0000 opacity=0.5\npart a kind=box size=1,1,1 mat=m'),
      build(SCENE_SOURCE_EXAMPLE),
    ];
    const redMesh = sceneToMesh(red);
    expect(redMesh.triangles[0]?.color).toEqual([255, 0, 0]);
    expect(redMesh.triangles[0]?.opacity).toBe(0.5);
    // #b08d57 is brass, and brass is not the fallback grey.
    expect(sceneToMesh(brass).triangles[0]?.color).toEqual([176, 141, 87]);
  });

  it('falls back to grey, not to a guess, when the colour did not resolve', () => {
    const unresolved = sceneToMesh(build('scene s\nmaterial m color=notacolour\npart a kind=box size=1,1,1 mat=m'));
    expect(unresolved.triangles[0]?.color).toEqual([176, 176, 176]);
  });

  it('tessellates every kind into its own world-space extent', () => {
    const digest = digestOf(`scene s
part box kind=box size=2,4,6
part cylinder kind=cylinder size=1,2,0
part cone kind=cone size=1,2,0
part sphere kind=sphere size=3,0,0
part torus kind=torus size=4,1,0`);
    const mesh = sceneToMesh(build(`scene s
part box kind=box size=2,4,6
part cylinder kind=cylinder size=1,2,0
part cone kind=cone size=1,2,0
part sphere kind=sphere size=3,0,0
part torus kind=torus size=4,1,0`));
    expect(new Set(mesh.triangles.map((triangle) => triangle.part))).toEqual(
      new Set(['box', 'cylinder', 'cone', 'sphere', 'torus']),
    );
    for (const name of Object.keys(digest.partBounds)) {
      const corners = mesh.triangles
        .filter((triangle) => triangle.part === name)
        .flatMap((triangle) => [mesh.positions[triangle.a], mesh.positions[triangle.b], mesh.positions[triangle.c]]);
      const bounds = digest.partBounds[name];
      for (let axis = 0; axis < 3; axis++) {
        const values = corners.map((corner) => corner?.[axis] ?? Number.NaN);
        expect(Math.min(...values)).toBeCloseTo(bounds?.min[axis] ?? Number.NaN, 6);
        expect(Math.max(...values)).toBeCloseTo(bounds?.max[axis] ?? Number.NaN, 6);
      }
    }
  });

  it('leaves an empty group out of the bounds but never out of the names', () => {
    const digest = digestOf('scene s\npart holder kind=group\npart thing kind=box size=1,1,1 parent=holder');
    expect(digest.partNames).toEqual(['holder', 'thing']);
    expectVec(min(digest.partBounds.holder), [-0.5, -0.5, -0.5]);
    expectVec(max(digest.partBounds.holder), [0.5, 0.5, 0.5]);
    expect(sceneToMesh(build('scene s\npart holder kind=group\npart thing kind=box size=1,1,1 parent=holder')).triangles)
      .toHaveLength(12);

    const empty = digestOf('scene s\npart holder kind=group\npart far kind=box size=1,1,1');
    expect(empty.partNames).toEqual(['holder', 'far']);
    expect(empty.partBounds.holder).toBeUndefined();
    expect(empty.partBounds.far).toBeDefined();
  });
});

/* ------------------------------------------------------------------ */
/* The GLB                                                             */
/* ------------------------------------------------------------------ */

describe('the GLB', () => {
  const glb = glbFor(SCENE_SOURCE_EXAMPLE);

  it('writes a header whose magic, version and length are right', () => {
    const header = new DataView(glb.bytes.buffer, glb.bytes.byteOffset, glb.bytes.byteLength);
    expect(header.getUint32(0, true)).toBe(0x46546c67);
    expect(header.getUint32(4, true)).toBe(2);
    expect(header.getUint32(8, true)).toBe(glb.bytes.length);
    expect(header.getUint32(16, true)).toBe(0x4e4f534a); // "JSON"
    expect(glb.jsonChunkLength % 4).toBe(0);
    const binStart = 20 + glb.jsonChunkLength;
    expect(header.getUint32(binStart + 4, true)).toBe(0x004e4942); // "BIN\0"
    expect(header.getUint32(binStart, true) % 4).toBe(0);
  });

  it('parses as JSON with the asset block the format requires', () => {
    expect(glb.json.asset.version).toBe('2.0');
    expect(glb.json.asset.generator).toBe('anascummis design harness');
    expect(glb.json.buffers).toHaveLength(1);
    expect(glb.json.buffers[0]?.uri).toBeUndefined();
    expect(glb.json.bufferViews.every((view) => view.buffer === 0)).toBe(true);
    expect(glb.json.bufferViews.every((view) => (view.byteOffset ?? 0) % 4 === 0)).toBe(true);
    expect(glb.json.scenes[0]?.nodes).toEqual([0]);
  });

  it('gives the POSITION accessors the bounds of the positions actually written', () => {
    expect(glb.json.meshes.length).toBeGreaterThan(0);
    for (const mesh of glb.json.meshes) {
      const primitive = mesh.primitives[0];
      if (!primitive) throw new Error('a mesh with no primitive');
      const accessorIndex = primitive.attributes.POSITION;
      const accessor = glb.json.accessors[accessorIndex];
      const positions = readVec3(glb, accessorIndex);
      expect(positions).toHaveLength(accessor?.count ?? -1);
      expect(accessor?.type).toBe('VEC3');
      expect(accessor?.componentType).toBe(5126);
      for (let axis = 0; axis < 3; axis++) {
        const values = positions.map((position) => position[axis] ?? Number.NaN);
        expect(accessor?.min?.[axis]).toBeCloseTo(Math.min(...values), 6);
        expect(accessor?.max?.[axis]).toBeCloseTo(Math.max(...values), 6);
      }
      // Every index addresses a vertex that is really there.
      const indices = new Uint32Array(readBytes(glb, primitive.indices).slice().buffer);
      expect(indices.length % 3).toBe(0);
      expect(Math.max(...indices)).toBeLessThan(positions.length);
    }
  });

  it('gives every non-group part a node and a mesh, and the hierarchy its children', () => {
    expect(glb.json.nodes.map((node) => node.name)).toEqual(['lamp', 'base', 'post', 'shade']);
    expect(glb.json.nodes.map((node) => node.mesh)).toEqual([undefined, 0, 1, 2]);
    expect(glb.json.nodes[0]?.children).toEqual([1]);
    expect(glb.json.nodes[1]?.children).toEqual([2]);
    expect(glb.json.nodes[2]?.children).toEqual([3]);
    expect(glb.json.nodes[3]?.children).toBeUndefined();
    expect(glb.json.meshes.map((mesh) => mesh.name)).toEqual(['baseMesh', 'postMesh', 'shadeMesh']);
  });

  it('puts local translations on the nodes, which is what makes them world', () => {
    // The node tree is the transform: each part's mesh is written in its own
    // frame, so a consumer composing the nodes lands on the digest's bounds.
    const parentOf = new Map<number, number>();
    glb.json.nodes.forEach((node, index) => {
      for (const child of node.children ?? []) parentOf.set(child, index);
    });
    const digest = sceneDigest(build(SCENE_SOURCE_EXAMPLE));
    glb.json.nodes.forEach((node, index) => {
      if (node.mesh === undefined) return;
      const world = [0, 0, 0];
      for (let cursor: number | undefined = index; cursor !== undefined; cursor = parentOf.get(cursor)) {
        const ancestor = glb.json.nodes[cursor];
        for (let axis = 0; axis < 3; axis++) {
          world[axis] = (world[axis] ?? 0) + (ancestor?.translation?.[axis] ?? 0);
        }
      }
      const accessor = glb.json.accessors[glb.json.meshes[node.mesh]?.primitives[0]?.attributes.POSITION ?? -1];
      const expected = digest.partBounds[node.name];
      for (let axis = 0; axis < 3; axis++) {
        expect((world[axis] ?? 0) + (accessor?.min?.[axis] ?? 0)).toBeCloseTo(expected?.min[axis] ?? Number.NaN, 6);
        expect((world[axis] ?? 0) + (accessor?.max?.[axis] ?? 0)).toBeCloseTo(expected?.max[axis] ?? Number.NaN, 6);
      }
    });
  });

  it('writes the rotation as a quaternion, and the unit as a scale on the roots', () => {
    const turned = glbFor('scene s\npart a kind=box size=1,1,1 rotation=0,0,90\npart b kind=box size=1,1,1 parent=a');
    expectVec(turned.json.nodes[0]?.rotation, [0, 0, Math.SQRT1_2, Math.SQRT1_2]);
    expectVec(turned.json.nodes[1]?.rotation, [0, 0, 0, 1]);
    // No unit was declared, so nothing is rescaled.
    expect(turned.json.nodes[0]?.scale).toBeUndefined();

    const centimetres = glbFor('scene s unit=cm\npart a kind=box size=1,1,1\npart b kind=box size=1,1,1 parent=a');
    expectVec(centimetres.json.nodes[0]?.scale, [0.01, 0.01, 0.01]);
    // The scale belongs on the node with no ancestor; a child that repeated it
    // would compound it.
    expect(centimetres.json.nodes[1]?.scale).toBeUndefined();
  });

  it('carries the materials across as metallic-roughness', () => {
    const typical = glb.json.materials[0];
    expect(typical?.name).toBe('brass');
    expectVec(typical?.pbrMetallicRoughness.baseColorFactor, [176 / 255, 141 / 255, 87 / 255, 1]);
    expect(typical?.pbrMetallicRoughness.metallicFactor).toBe(0.8);
    expect(typical?.pbrMetallicRoughness.roughnessFactor).toBe(0.3);
    expect(typical?.alphaMode).toBeUndefined();

    const translucent = glbFor('scene s\nmaterial glass color=#ffffff opacity=0.25\npart a kind=box size=1,1,1 mat=glass');
    expect(translucent.json.materials[0]?.alphaMode).toBe('BLEND');
    expect(translucent.json.materials[0]?.pbrMetallicRoughness.baseColorFactor[3]).toBe(0.25);

    // A part with no material still points at one, so no mesh is left dangling.
    const plain = glbFor('scene s\npart a kind=box size=1,1,1');
    expect(plain.json.meshes[0]?.primitives[0]?.material).toBe(0);
    expect(plain.json.materials[0]?.name).toBeUndefined();
  });

  it('refuses to compile a scene that does not validate', () => {
    const compiled = sceneToGlb(build('scene s\npart a kind=box size=1,1,1\njoint a revolute axis=1,0,0 range=5,5'));
    expect(compiled.ok).toBe(false);
    if (compiled.ok) return;
    expect(compiled.kind).toBe('invalid-argument');
    expect(compiled.message).toContain('minimum must be below');
  });

  it('leaves a group out of the meshes rather than writing an empty one', () => {
    expect(glb.json.meshes.some((mesh) => mesh.name === 'lampMesh')).toBe(false);
  });
});
