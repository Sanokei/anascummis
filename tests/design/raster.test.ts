import { describe, expect, it } from 'vitest';
import {
  STANDARD_VIEWS,
  contactSheet,
  createRaster,
  decodePng,
  deflateStored,
  encodePng,
  getPixel,
  imageStats,
  renderMesh,
  renderViews,
  setPixel,
} from '../../src/worker/design/raster';
import type { Mesh, Raster, Vec3, ViewRender, ViewSpec } from '../../src/worker/design/types';

/**
 * The raster module has two halves, and they fail in different ways.
 *
 * PNG is a format with checksums in it, so most of what a decoder can get wrong
 * is caught by a decoder that disagrees with a writer nobody is checking —
 * which is why the streams below are built here, by hand, from the
 * specification's own arithmetic rather than by the module. A wrong Paeth
 * predictor is invisible in a round trip through the module's own writer, where
 * both ends would be wrong in the same direction, and unmissable against a
 * filtered stream built independently.
 *
 * The rasteriser is geometry, so it is tested by what lands on the canvas: ink
 * where a visible triangle is, none where the camera cannot see, and the same
 * picture at two sizes because the framing is measured from the subject rather
 * than from a camera distance.
 */

/* ------------------------------------------------------------------ */
/* A PNG writer that shares nothing with the module under test         */
/* ------------------------------------------------------------------ */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function readU32(source: Uint8Array, offset: number): number {
  const b0 = source[offset] ?? 0;
  const b1 = source[offset + 1] ?? 0;
  const b2 = source[offset + 2] ?? 0;
  const b3 = source[offset + 3] ?? 0;
  return ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
}

/** Bitwise CRC-32, deliberately not the table-driven form the module uses. */
function testCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function testAdler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function buildChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(out.subarray(4, 8), 0);
  crcInput.set(data, 4);
  view.setUint32(8 + data.length, testCrc32(crcInput), false);
  return out;
}

/** Hand-written stored deflate blocks, so no test owes anything to the module's writer. */
function storedZlib(raw: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [new Uint8Array([0x78, 0x01])];
  let position = 0;
  do {
    const length = Math.min(65535, raw.length - position);
    const block = new Uint8Array(5 + length);
    block[0] = position + length >= raw.length ? 1 : 0;
    block[1] = length & 0xff;
    block[2] = (length >>> 8) & 0xff;
    block[3] = ~length & 0xff;
    block[4] = (~length >>> 8) & 0xff;
    block.set(raw.subarray(position, position + length), 5);
    parts.push(block);
    position += length;
  } while (position < raw.length);
  const sum = testAdler32(raw);
  parts.push(new Uint8Array([(sum >>> 24) & 0xff, (sum >>> 16) & 0xff, (sum >>> 8) & 0xff, sum & 0xff]));
  return concat(parts);
}

interface PngSpec {
  width: number;
  height: number;
  colorType: number;
  bitDepth?: number;
  interlace?: number;
  palette?: Uint8Array;
  transparency?: Uint8Array;
  idat: Uint8Array;
}

function pngOf(spec: PngSpec): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, spec.width, false);
  view.setUint32(4, spec.height, false);
  header[8] = spec.bitDepth ?? 8;
  header[9] = spec.colorType;
  header[10] = 0;
  header[11] = 0;
  header[12] = spec.interlace ?? 0;
  const parts = [new Uint8Array(PNG_SIGNATURE), buildChunk('IHDR', header)];
  if (spec.palette) parts.push(buildChunk('PLTE', spec.palette));
  if (spec.transparency) parts.push(buildChunk('tRNS', spec.transparency));
  parts.push(buildChunk('IDAT', spec.idat));
  parts.push(buildChunk('IEND', new Uint8Array(0)));
  return concat(parts);
}

interface Chunk {
  type: string;
  data: Uint8Array;
  crcMatches: boolean;
}

function chunksOf(png: Uint8Array): Chunk[] {
  const out: Chunk[] = [];
  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= png.length) {
    const length = readU32(png, offset);
    const type = String.fromCharCode(
      png[offset + 4] ?? 0,
      png[offset + 5] ?? 0,
      png[offset + 6] ?? 0,
      png[offset + 7] ?? 0,
    );
    const data = png.slice(offset + 8, offset + 8 + length);
    const crcInput = concat([png.slice(offset + 4, offset + 8), data]);
    out.push({ type, data, crcMatches: readU32(png, offset + 8 + length) === testCrc32(crcInput) });
    offset += 12 + length;
  }
  return out;
}

function idatOf(png: Uint8Array): Uint8Array {
  return concat(
    chunksOf(png)
      .filter((chunk) => chunk.type === 'IDAT')
      .map((chunk) => chunk.data),
  );
}

/** Reads a transform's output while the write is still in flight, or the write can block. */
async function runStream(stream: { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> }, input: Uint8Array): Promise<Uint8Array> {
  const writing = (async () => {
    const writer = stream.writable.getWriter();
    await writer.write(input);
    await writer.close();
  })();
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  await writing;
  return concat(chunks);
}

function inflate(data: Uint8Array): Promise<Uint8Array> {
  return runStream(new DecompressionStream('deflate'), data);
}

function deflate(data: Uint8Array): Promise<Uint8Array> {
  return runStream(new CompressionStream('deflate'), data);
}

/* ------------------------------------------------------------------ */
/* Filters, written from the specification rather than from the module */
/* ------------------------------------------------------------------ */

function testPaeth(left: number, up: number, upperLeft: number): number {
  const p = left + up - upperLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upperLeft);
  if (pa <= pb && pa <= pc) return left;
  if (pb <= pc) return up;
  return upperLeft;
}

/** Filters a raster's rows as 8-bit RGBA, choosing the filter type per row. */
function filterRaster(raster: Raster, filterFor: (row: number) => number): Uint8Array {
  const channels = 4;
  const rowBytes = raster.width * channels;
  const stride = rowBytes + 1;
  const out = new Uint8Array(stride * raster.height);
  for (let y = 0; y < raster.height; y++) {
    const type = filterFor(y);
    out[y * stride] = type;
    for (let x = 0; x < rowBytes; x++) {
      const value = raster.rgba[y * rowBytes + x] ?? 0;
      const left = x >= channels ? (raster.rgba[y * rowBytes + x - channels] ?? 0) : 0;
      const up = y > 0 ? (raster.rgba[(y - 1) * rowBytes + x] ?? 0) : 0;
      const upperLeft = y > 0 && x >= channels ? (raster.rgba[(y - 1) * rowBytes + x - channels] ?? 0) : 0;
      let filtered: number;
      switch (type) {
        case 1:
          filtered = value - left;
          break;
        case 2:
          filtered = value - up;
          break;
        case 3:
          filtered = value - ((left + up) >> 1);
          break;
        case 4:
          filtered = value - testPaeth(left, up, upperLeft);
          break;
        default:
          filtered = value;
          break;
      }
      out[y * stride + 1 + x] = filtered & 0xff;
    }
  }
  return out;
}

/** Unfiltered scanlines carrying raw samples, for the colour types the encoder never writes. */
function sampleRows(samples: number[], width: number, height: number, channels: number): Uint8Array {
  const rowBytes = width * channels;
  const stride = rowBytes + 1;
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    out[y * stride] = 0;
    for (let x = 0; x < rowBytes; x++) out[y * stride + 1 + x] = samples[y * rowBytes + x] ?? 0;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const FRONT: ViewSpec = { name: 'front', offset: [0, 0, 3], up: [0, 1, 0] };
const NO_CAMERA: ViewSpec = { name: 'front', offset: [0, 0, 0], up: [0, 1, 0] };
const BLACK: [number, number, number, number] = [0, 0, 0, 255];

/** Four colours in bands, with a transparent rectangle in the middle. */
function patternedRaster(width = 23, height = 17): Raster {
  const palette: [number, number, number, number][] = [
    [255, 0, 0, 255],
    [0, 128, 255, 255],
    [12, 34, 56, 255],
    [255, 255, 0, 200],
  ];
  const raster = createRaster(width, height, [0, 0, 0, 0]);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= 4 && x < 12 && y >= 3 && y < 9) continue;
      setPixel(raster, x, y, palette[(x * 3 + y) % palette.length] ?? [0, 0, 0, 255]);
    }
  }
  return raster;
}

interface TriangleSpec {
  points: [Vec3, Vec3, Vec3];
  normal: Vec3;
  color: [number, number, number];
  part?: string;
}

function meshOf(specs: TriangleSpec[]): Mesh {
  const positions: Vec3[] = [];
  const triangles: Mesh['triangles'] = [];
  for (const spec of specs) {
    const base = positions.length;
    positions.push(spec.points[0], spec.points[1], spec.points[2]);
    triangles.push({
      a: base,
      b: base + 1,
      c: base + 2,
      normal: spec.normal,
      color: spec.color,
      opacity: 1,
      part: spec.part ?? 'test',
    });
  }
  return { positions, triangles };
}

/** A triangle spanning a two-unit square in the xy plane, facing +z. */
function facingTriangle(z: number, color: [number, number, number], part?: string): TriangleSpec {
  return {
    points: [
      [-1, -1, z],
      [1, -1, z],
      [0, 1, z],
    ],
    normal: [0, 0, 1],
    color,
    part,
  };
}

/**
 * A tetrahedron, for the tests that need a subject with real thickness.
 *
 * A flat triangle is the right fixture for the depth and framing tests and the
 * wrong one for anything that looks along an axis of the plane it lies in: from
 * directly above, a triangle in the xy plane is edge-on, covers no pixel centre
 * at all, and a top view of it is legitimately blank.
 */
function tetrahedron(color: [number, number, number] = [200, 120, 60]): Mesh {
  const corners: Vec3[] = [
    [1, 1, 1],
    [-1, -1, 1],
    [-1, 1, -1],
    [1, -1, -1],
  ];
  const faces: [number, number, number][] = [
    [0, 1, 2],
    [0, 3, 1],
    [0, 2, 3],
    [1, 3, 2],
  ];
  const specs: TriangleSpec[] = [];
  for (const face of faces) {
    const a = corners[face[0]] ?? [0, 0, 0];
    const b = corners[face[1]] ?? [0, 0, 0];
    const c = corners[face[2]] ?? [0, 0, 0];
    // The outward normal, from the winding: this fixture is built by hand, so
    // the shading has to be told which way each face points.
    const u: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    specs.push({
      points: [a, b, c],
      normal: [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]],
      color,
      part: 'tetra',
    });
  }
  return meshOf(specs);
}

function viewRenderOf(name: string, raster: Raster): ViewRender {
  return { view: name, raster, stats: imageStats(raster) };
}

/** Pixels that differ from an opaque black background. */
function countInk(raster: Raster): number {
  let ink = 0;
  for (let y = 0; y < raster.height; y++) {
    for (let x = 0; x < raster.width; x++) {
      const [r, g, b] = getPixel(raster, x, y);
      if (r !== 0 || g !== 0 || b !== 0) ink += 1;
    }
  }
  return ink;
}

function samePixels(a: Raster, b: Raster): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  for (let i = 0; i < a.rgba.length; i++) {
    if ((a.rgba[i] ?? 0) !== (b.rgba[i] ?? 0)) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* PNG round trips                                                     */
/* ------------------------------------------------------------------ */

describe('PNG encoding and decoding', () => {
  it('round-trips every pixel, transparent region included', async () => {
    const raster = patternedRaster();
    const decoded = await decodePng(await encodePng(raster));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.value.width).toBe(23);
    expect(decoded.value.height).toBe(17);
    expect(samePixels(decoded.value, raster)).toBe(true);
  });

  it('writes the signature, an 8-bit RGBA header, and checksums an independent CRC agrees with', async () => {
    const png = await encodePng(patternedRaster());
    expect([...png.subarray(0, 8)]).toEqual(PNG_SIGNATURE);

    const chunks = chunksOf(png);
    expect(chunks.map((chunk) => chunk.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    // The CRC covers the chunk type and its data, and not the length field in
    // front of them, which is the detail a hand-written encoder gets wrong.
    for (const chunk of chunks) expect([chunk.type, chunk.crcMatches]).toEqual([chunk.type, true]);

    const header = chunks[0];
    expect(header).toBeDefined();
    if (!header) return;
    expect(readU32(header.data, 0)).toBe(23);
    expect(readU32(header.data, 4)).toBe(17);
    expect(header.data[8]).toBe(8); // bit depth
    expect(header.data[9]).toBe(6); // colour type 6, truecolour with alpha
    expect(header.data[10]).toBe(0); // compression method
    expect(header.data[11]).toBe(0); // filter method
    expect(header.data[12]).toBe(0); // interlace method
  });

  it('wraps the IDAT in zlib and inflates to exactly the scanlines it filtered', async () => {
    const raster = patternedRaster(9, 5);
    const idat = idatOf(await encodePng(raster));

    // The zlib header: deflate in the low nibble of CMF, and the two bytes
    // together a multiple of 31. True of both the compressed and the stored
    // path, which is the point — every IDAT this module writes is a zlib
    // stream, so a decoder never has to guess which one it got.
    expect(idat[0]).toBe(0x78);
    expect((((idat[0] ?? 0) << 8) | (idat[1] ?? 0)) % 31).toBe(0);

    // Filter type 0 on every row, then the row's bytes verbatim.
    const rowBytes = raster.width * 4;
    const expected = new Uint8Array((rowBytes + 1) * raster.height);
    for (let y = 0; y < raster.height; y++) {
      expected[y * (rowBytes + 1)] = 0;
      expected.set(raster.rgba.subarray(y * rowBytes, (y + 1) * rowBytes), y * (rowBytes + 1) + 1);
    }
    expect([...(await inflate(idat))]).toEqual([...expected]);

    // The Adler-32 trailer, computed here rather than read back off the stream.
    expect(readU32(idat, idat.length - 4)).toBe(testAdler32(expected));
  });

  it('uses the runtime deflate when the runtime has one', async () => {
    // The observation that the fast path is live: a flat image is exactly what
    // deflate collapses, so a compressed IDAT is a fraction of the scanlines it
    // carries where the stored fallback would be larger than them.
    const raster = createRaster(64, 64, [40, 90, 140, 255]);
    const idat = idatOf(await encodePng(raster));
    const rawBytes = (raster.width * 4 + 1) * raster.height;
    expect(idat.length).toBeLessThan(rawBytes / 4);
    expect([...(await inflate(idat))].length).toBe(rawBytes);
  });

  it('round-trips a PNG whose IDAT is stored blocks', async () => {
    const raster = patternedRaster(11, 7);
    const raw = filterRaster(raster, () => 0);
    const stored = deflateStored(raw);

    // The fallback has to be a zlib stream in its own right before it can be an
    // IDAT: header, then blocks, then the Adler-32 of what it carries.
    expect(stored[0]).toBe(0x78);
    expect((((stored[0] ?? 0) << 8) | (stored[1] ?? 0)) % 31).toBe(0);
    expect(readU32(stored, stored.length - 4)).toBe(testAdler32(raw));
    expect([...(await inflate(stored))]).toEqual([...raw]);

    const decoded = await decodePng(
      pngOf({ width: raster.width, height: raster.height, colorType: 6, idat: stored }),
    );
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(samePixels(decoded.value, raster)).toBe(true);
  });

  it('chunks stored data into 65535-byte blocks whose NLEN complements LEN', async () => {
    const raw = new Uint8Array(70000);
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 7) & 0xff;
    const stream = deflateStored(raw);

    let offset = 2;
    let produced = 0;
    let blocks = 0;
    for (;;) {
      const header = stream[offset] ?? 0;
      const length = (stream[offset + 1] ?? 0) | ((stream[offset + 2] ?? 0) << 8);
      const complement = (stream[offset + 3] ?? 0) | ((stream[offset + 4] ?? 0) << 8);
      expect(complement).toBe(~length & 0xffff);
      expect(length).toBeLessThanOrEqual(65535);
      produced += length;
      blocks += 1;
      offset += 5 + length;
      if ((header & 1) === 1) break;
      expect(blocks).toBeLessThan(10);
    }
    // 70000 bytes is two blocks, and the second one is short.
    expect(blocks).toBe(2);
    expect(produced).toBe(raw.length);
    expect(offset + 4).toBe(stream.length);
    expect([...(await inflate(stream))]).toEqual([...raw]);
  });

  it('agrees with the platform deflate on what a stream contains', async () => {
    // Both writers must be readable by a plain inflater, byte for byte, or the
    // fallback is not a fallback for whatever the platform cannot produce.
    const raw = new Uint8Array(300);
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 13) & 0xff;
    expect([...(await inflate(await deflate(raw)))]).toEqual([...raw]);
    expect([...(await inflate(deflateStored(raw)))]).toEqual([...raw]);
  });
});

/* ------------------------------------------------------------------ */
/* Scanline filters                                                    */
/* ------------------------------------------------------------------ */

describe('scanline filters', () => {
  const cases: { name: string; raster: () => Raster }[] = [
    {
      // Sub: each byte against the pixel to its left. A horizontal gradient
      // reduces to a constant, so a decoder that gets the offset by one pixel
      // wrong — or reads the file's bytes instead of the row it is rebuilding —
      // lands somewhere else entirely.
      name: 'a horizontal gradient',
      raster: () => {
        const raster = createRaster(23, 9, [0, 0, 0, 255]);
        for (let y = 0; y < 9; y++) {
          for (let x = 0; x < 23; x++) setPixel(raster, x, y, [x * 11, 255 - x * 11, (x * 5) & 0xff, 255]);
        }
        return raster;
      },
    },
    {
      // Up: each byte against the pixel above it.
      name: 'a vertical gradient',
      raster: () => {
        const raster = createRaster(7, 31, [0, 0, 0, 255]);
        for (let y = 0; y < 31; y++) {
          for (let x = 0; x < 7; x++) setPixel(raster, x, y, [y * 8, (y * 3) & 0xff, 255 - y * 8, 255]);
        }
        return raster;
      },
    },
    {
      // A diagonal pattern with noise, so every predictor branch is taken. This
      // is what catches a Paeth whose three-way comparison is wrong: a round
      // trip through the module's own writer would not, because both ends would
      // be wrong in the same direction.
      name: 'a diagonal pattern',
      raster: () => {
        const raster = createRaster(20, 20, [0, 0, 0, 255]);
        let seed = 12345;
        const next = (): number => {
          seed = (seed * 1103515245 + 12345) & 0x7fffffff;
          return seed & 0xff;
        };
        for (let y = 0; y < 20; y++) {
          for (let x = 0; x < 20; x++) {
            setPixel(raster, x, y, [(x * 16 + y * 8 + next()) & 0xff, (x * y + next()) & 0xff, next(), 255]);
          }
        }
        return raster;
      },
    },
  ];

  for (const subject of cases) {
    it(`undoes all five filters applied to ${subject.name}`, async () => {
      const raster = subject.raster();
      for (const filter of [0, 1, 2, 3, 4]) {
        const png = pngOf({
          width: raster.width,
          height: raster.height,
          colorType: 6,
          idat: storedZlib(filterRaster(raster, () => filter)),
        });
        const decoded = await decodePng(png);
        expect(decoded.ok).toBe(true);
        if (!decoded.ok) continue;
        expect([filter, samePixels(decoded.value, raster)]).toEqual([filter, true]);
      }
    });
  }

  it('undoes a stream that changes filter type from row to row', async () => {
    const raster = cases[2]?.raster() ?? patternedRaster();
    const png = pngOf({
      width: raster.width,
      height: raster.height,
      colorType: 6,
      idat: storedZlib(filterRaster(raster, (row) => row % 5)),
    });
    const decoded = await decodePng(png);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(samePixels(decoded.value, raster)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Refusals                                                            */
/* ------------------------------------------------------------------ */

describe('PNG refusals', () => {
  it('fails rather than throwing on a bad signature, a truncation and a bad CRC', async () => {
    const png = await encodePng(patternedRaster());

    const wrongSignature = png.slice();
    wrongSignature[3] = 0x00;
    const signature = await decodePng(wrongSignature);

    const tooShort = await decodePng(png.slice(0, 20));
    const empty = await decodePng(new Uint8Array(0));
    // Cut mid-chunk: the last six bytes of the file are half an IEND header.
    const clipped = await decodePng(png.slice(0, png.length - 6));
    // A whole file that simply stops after its data.
    const noEnd = await decodePng(png.slice(0, png.length - 12));

    const badCrc = png.slice();
    badCrc[45] = (badCrc[45] ?? 0) ^ 0xff;
    const crc = await decodePng(badCrc);

    for (const result of [signature, tooShort, empty, clipped, noEnd, crc]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.kind).toBe('invalid-argument');
    }
    if (!signature.ok) expect(signature.message).toMatch(/signature/);
    if (!tooShort.ok) expect(tooShort.message).toMatch(/runs past the end/);
    if (!clipped.ok) expect(clipped.message).toMatch(/ends inside a chunk header/);
    if (!noEnd.ok) expect(noEnd.message).toMatch(/without an IEND chunk/);
    if (!crc.ok) expect(crc.message).toMatch(/^The IDAT chunk fails its CRC/);
  });

  it('refuses interlacing and sub-byte samples as unsupported rather than guessing', async () => {
    const raster = patternedRaster(8, 4);
    const idat = storedZlib(filterRaster(raster, () => 0));

    const interlaced = await decodePng(pngOf({ width: 8, height: 4, colorType: 6, interlace: 1, idat }));
    const fourBit = await decodePng(pngOf({ width: 8, height: 4, colorType: 6, bitDepth: 4, idat }));
    const greyWithTransparency = await decodePng(
      pngOf({ width: 2, height: 1, colorType: 0, transparency: new Uint8Array([0, 5]), idat }),
    );

    for (const result of [interlaced, fourBit, greyWithTransparency]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.kind).toBe('unsupported-runtime');
    }
  });

  it('reads greyscale, truecolour, palette and greyscale+alpha', async () => {
    const grey = await decodePng(
      pngOf({ width: 4, height: 1, colorType: 0, idat: storedZlib(sampleRows([0, 128, 255, 42], 4, 1, 1)) }),
    );
    expect(grey.ok).toBe(true);
    if (grey.ok) {
      expect(getPixel(grey.value, 0, 0)).toEqual([0, 0, 0, 255]);
      expect(getPixel(grey.value, 1, 0)).toEqual([128, 128, 128, 255]);
      expect(getPixel(grey.value, 3, 0)).toEqual([42, 42, 42, 255]);
    }

    const rgb = await decodePng(
      pngOf({ width: 2, height: 1, colorType: 2, idat: storedZlib(sampleRows([1, 2, 3, 250, 251, 252], 2, 1, 3)) }),
    );
    expect(rgb.ok).toBe(true);
    if (rgb.ok) {
      expect(getPixel(rgb.value, 0, 0)).toEqual([1, 2, 3, 255]);
      expect(getPixel(rgb.value, 1, 0)).toEqual([250, 251, 252, 255]);
    }

    const greyAlpha = await decodePng(
      pngOf({ width: 2, height: 1, colorType: 4, idat: storedZlib(sampleRows([90, 255, 90, 0], 2, 1, 2)) }),
    );
    expect(greyAlpha.ok).toBe(true);
    if (greyAlpha.ok) {
      expect(getPixel(greyAlpha.value, 0, 0)).toEqual([90, 90, 90, 255]);
      expect(getPixel(greyAlpha.value, 1, 0)).toEqual([90, 90, 90, 0]);
    }

    const palette = await decodePng(
      pngOf({
        width: 3,
        height: 1,
        colorType: 3,
        palette: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255]),
        transparency: new Uint8Array([255, 128, 0]),
        idat: storedZlib(sampleRows([0, 1, 2], 3, 1, 1)),
      }),
    );
    expect(palette.ok).toBe(true);
    if (palette.ok) {
      // tRNS on an indexed image is per-entry alpha, and it does not have to be
      // as long as the palette.
      expect(getPixel(palette.value, 0, 0)).toEqual([255, 0, 0, 255]);
      expect(getPixel(palette.value, 1, 0)).toEqual([0, 255, 0, 128]);
      expect(getPixel(palette.value, 2, 0)).toEqual([0, 0, 255, 0]);
    }
  });

  it('reports a palette index that has no entry', async () => {
    const result = await decodePng(
      pngOf({
        width: 2,
        height: 1,
        colorType: 3,
        palette: new Uint8Array([1, 2, 3]),
        idat: storedZlib(sampleRows([0, 4], 2, 1, 1)),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/palette index 4/);
  });
});

/* ------------------------------------------------------------------ */
/* Image statistics                                                    */
/* ------------------------------------------------------------------ */

describe('imageStats', () => {
  it('calls a solid canvas blank', () => {
    const stats = imageStats(createRaster(8, 8, [12, 34, 56, 255]));
    expect(stats.blank).toBe(true);
    expect(stats.distinctColors).toBe(1);
    expect(stats.background).toBe('#0c2238');
    expect(stats.backgroundShare).toBe(1);
    expect(stats.inkCoverage).toBe(0);
    expect(stats.edgeCoverage).toBe(0);
    expect(stats.contrastRatio).toBe(1);
    expect(stats.palette).toEqual([{ hex: '#0c2238', share: 1 }]);
  });

  it('reports a border as edge coverage', () => {
    const raster = createRaster(16, 16, [255, 255, 255, 255]);
    for (let i = 0; i < 16; i++) {
      setPixel(raster, i, 0, [0, 0, 0, 255]);
      setPixel(raster, i, 15, [0, 0, 0, 255]);
      setPixel(raster, 0, i, [0, 0, 0, 255]);
      setPixel(raster, 15, i, [0, 0, 0, 255]);
    }
    const stats = imageStats(raster);
    // Every pixel of the one-pixel border is ink, which is what a drawing
    // scaled past the canvas looks like.
    expect(stats.edgeCoverage).toBe(1);
    expect(stats.background).toBe('#ffffff');
    expect(stats.blank).toBe(false);
    expect(stats.inkCoverage).toBeCloseTo(1 - 196 / 256, 10);
  });

  it('measures the maximum contrast between a black ground and a white subject', () => {
    const raster = createRaster(20, 20, [0, 0, 0, 255]);
    for (let y = 8; y < 12; y++) {
      for (let x = 8; x < 12; x++) setPixel(raster, x, y, [255, 255, 255, 255]);
    }
    const stats = imageStats(raster);
    expect(stats.background).toBe('#000000');
    expect(stats.contrastRatio).toBeGreaterThan(20);
    expect(stats.palette).toEqual([
      { hex: '#000000', share: 384 / 400 },
      { hex: '#ffffff', share: 16 / 400 },
    ]);
    let share = 0;
    for (const entry of stats.palette) share += entry.share;
    expect(share).toBeCloseTo(1, 10);
    expect(stats.meanLuminance).toBeCloseTo(16 / 400, 10);
  });

  it('drops fully transparent pixels from the colour statistics but not from the coverage', () => {
    const raster = createRaster(10, 10, [255, 0, 0, 255]);
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 5; x++) setPixel(raster, x, y, [0, 0, 0, 0]);
    }
    const stats = imageStats(raster);
    expect(stats.background).toBe('#ff0000');
    expect(stats.distinctColors).toBe(1);
    expect(stats.backgroundShare).toBeCloseTo(0.5, 10);
    expect(stats.palette).toHaveLength(1);
    expect(stats.contrastRatio).toBe(1);
    expect(stats.meanLuminance).toBeCloseTo(0.2126, 4);
    // A transparent pixel is not the background colour, so it counts as ink and
    // as edge coverage. The convention is deliberate: a background rectangle
    // that stops short of the canvas is a framing defect, and this is the
    // statistic that reports it. Half of this canvas's border is transparent,
    // so half of it is ink.
    expect(stats.inkCoverage).toBeCloseTo(0.5, 10);
    expect(stats.edgeCoverage).toBeCloseTo(0.5, 10);
  });

  it('reports an empty canvas as empty rather than inventing a colour', () => {
    const stats = imageStats(createRaster(4, 4, [0, 0, 0, 0]));
    expect(stats.blank).toBe(true);
    expect(stats.distinctColors).toBe(0);
    expect(stats.backgroundShare).toBe(0);
    expect(stats.palette).toEqual([]);
    expect(stats.inkCoverage).toBe(0);
    expect(stats.edgeCoverage).toBe(0);
    expect(stats.meanLuminance).toBe(0);
  });

  it('breaks a tie for the background in scan order', () => {
    const raster = createRaster(4, 1, [0, 0, 0, 255]);
    setPixel(raster, 0, 0, [10, 20, 30, 255]);
    setPixel(raster, 1, 0, [10, 20, 30, 255]);
    setPixel(raster, 2, 0, [200, 100, 50, 255]);
    setPixel(raster, 3, 0, [200, 100, 50, 255]);
    // Two pixels each: the first colour drawn wins, so the answer does not
    // depend on the order a Map happens to hand its keys back.
    expect(imageStats(raster).background).toBe('#0a141e');
  });
});

/* ------------------------------------------------------------------ */
/* The rasteriser                                                      */
/* ------------------------------------------------------------------ */

describe('renderMesh', () => {
  it('draws a triangle facing the camera', () => {
    const mesh = meshOf([facingTriangle(0, [220, 60, 60])]);
    const raster = renderMesh(mesh, FRONT, { width: 64, height: 64, background: BLACK });
    const stats = imageStats(raster);
    expect(stats.blank).toBe(false);
    // The triangle is framed to the padded viewport and covers half of its own
    // bounding box, so something over a third of the canvas is the expected
    // order of things.
    expect(stats.inkCoverage).toBeGreaterThan(0.2);
    expect(stats.inkCoverage).toBeLessThan(0.5);
    // The padding is real: nothing reaches the border.
    expect(stats.edgeCoverage).toBe(0);
  });

  it('lets the nearer triangle win the depth test in either triangle order', () => {
    const near = facingTriangle(0.5, [255, 0, 0], 'near');
    const far = facingTriangle(-0.5, [0, 0, 255], 'far');

    for (const order of [
      [near, far],
      [far, near],
    ]) {
      const raster = renderMesh(meshOf(order), FRONT, { width: 48, height: 48, background: BLACK });
      // The two triangles project to the same pixels, so every drawn pixel is
      // the nearer one's: red, never blue.
      expect(countInk(raster)).toBeGreaterThan(100);
      for (let y = 0; y < raster.height; y++) {
        for (let x = 0; x < raster.width; x++) {
          const [r, g, b] = getPixel(raster, x, y);
          if (r === 0 && g === 0 && b === 0) continue;
          expect(b).toBe(0);
          expect(r).toBeGreaterThan(0);
        }
      }
    }
  });

  it('does not draw geometry behind the camera', () => {
    const mesh = meshOf([facingTriangle(0, [255, 0, 0], 'near'), facingTriangle(10, [0, 0, 255], 'far')]);
    // The eye sits two units from the subject's centre, so the triangle at
    // z = 10 is behind it while the one at the origin is in front.
    const view: ViewSpec = { name: 'front', offset: [0, 0, 2], up: [0, 1, 0] };

    const raster = renderMesh(mesh, view, { width: 48, height: 48, background: BLACK });
    expect(imageStats(raster).inkCoverage).toBeGreaterThan(0.05);
    for (let y = 0; y < raster.height; y++) {
      for (let x = 0; x < raster.width; x++) {
        const [r, g, b] = getPixel(raster, x, y);
        if (r === 0 && g === 0 && b === 0) continue;
        expect(b).toBe(0);
      }
    }

    // An offset with no length names a direction and no position, so there is
    // no eye plane for geometry to be behind and the whole mesh is framed. The
    // further triangle is then the one the depth order puts in front, which is
    // exactly the inversion the eye plane exists to prevent — and it is only
    // reachable because the caller said the camera has no position.
    const dimensionless = renderMesh(mesh, NO_CAMERA, { width: 48, height: 48, background: BLACK });
    let blueSeen = false;
    for (let y = 0; y < dimensionless.height; y++) {
      for (let x = 0; x < dimensionless.width; x++) {
        if (getPixel(dimensionless, x, y)[2] > 0) blueSeen = true;
      }
    }
    expect(blueSeen).toBe(true);
  });

  it('frames the subject the same at 100 and at 400 pixels', () => {
    const mesh = meshOf([facingTriangle(0, [200, 200, 200])]);
    const small = imageStats(renderMesh(mesh, FRONT, { width: 100, height: 100, background: BLACK }));
    const large = imageStats(renderMesh(mesh, FRONT, { width: 400, height: 400, background: BLACK }));
    expect(small.inkCoverage).toBeGreaterThan(0.2);
    expect(Math.abs(large.inkCoverage - small.inkCoverage) / small.inkCoverage).toBeLessThan(0.05);
  });

  it('skips a degenerate triangle instead of dividing by zero', () => {
    const mesh = meshOf([
      // Three vertices on one line: no screen area at all.
      { points: [[-1, -1, 0], [0, 0, 0], [1, 1, 0]], normal: [0, 0, 1], color: [255, 0, 0] },
      facingTriangle(0, [0, 255, 0]),
    ]);
    const raster = renderMesh(mesh, FRONT, { width: 32, height: 32, background: BLACK });
    expect(imageStats(raster).blank).toBe(false);
    // Only the green triangle is drawable, and the sliver must not have left a
    // trail of red pixels behind it.
    let redSeen = false;
    for (let y = 0; y < raster.height; y++) {
      for (let x = 0; x < raster.width; x++) {
        if (getPixel(raster, x, y)[0] > 0) redSeen = true;
      }
    }
    expect(redSeen).toBe(false);
  });

  it('draws triangle edges when a wireframe colour is given', () => {
    const mesh = meshOf([facingTriangle(0, [180, 180, 180])]);
    const options = { width: 40, height: 40, background: BLACK };
    const plain = renderMesh(mesh, FRONT, options);
    const wire = renderMesh(mesh, FRONT, { ...options, wireframe: [10, 20, 30] as [number, number, number] });

    let wirePixels = 0;
    let plainWirePixels = 0;
    for (let y = 0; y < wire.height; y++) {
      for (let x = 0; x < wire.width; x++) {
        if (getPixel(wire, x, y).join(',') === '10,20,30,255') wirePixels += 1;
        if (getPixel(plain, x, y).join(',') === '10,20,30,255') plainWirePixels += 1;
      }
    }
    // The perimeter of the framed triangle is around eighty pixels across its
    // three edges.
    expect(wirePixels).toBeGreaterThan(40);
    // The plain render has no such pixel, so the count above is the wireframe's
    // doing and not a coincidence of the shading.
    expect(plainWirePixels).toBe(0);
    expect(imageStats(wire).distinctColors).toBeGreaterThan(imageStats(plain).distinctColors);
  });

  it('falls back to another up vector when the given one is parallel to the view', () => {
    const mesh = tetrahedron();
    // Looking straight down with the world up as the up vector: their cross
    // product is zero, and every screen coordinate after it would be NaN.
    const parallel: ViewSpec = { name: 'top', offset: [0, 3, 0.0001], up: [0, 1, 0] };
    const explicit: ViewSpec = { name: 'top', offset: [0, 3, 0.0001], up: [0, 0, 1] };
    const fallback = renderMesh(mesh, parallel, { width: 32, height: 32 });
    const chosen = renderMesh(mesh, explicit, { width: 32, height: 32 });
    expect(imageStats(fallback).blank).toBe(false);
    // The fallback order tries the world axes in turn, so it lands on exactly
    // the axis a caller would otherwise have had to name by hand.
    expect(samePixels(fallback, chosen)).toBe(true);
  });

  it('refuses a triangle that names a vertex the mesh does not have', () => {
    const mesh: Mesh = {
      positions: [[0, 0, 0]],
      triangles: [{ a: 0, b: 1, c: 2, normal: [0, 0, 1], color: [255, 0, 0], opacity: 1, part: 'broken' }],
    };
    expect(() => renderMesh(mesh, FRONT)).toThrow(RangeError);
    expect(() => renderMesh(mesh, FRONT)).toThrow(/broken/);
  });

  it('clamps the viewport rather than allocating whatever it was asked for', () => {
    const mesh = meshOf([facingTriangle(0, [200, 200, 200])]);
    const raster = renderMesh(mesh, FRONT, { width: 100000, height: 4 });
    expect(raster.width).toBe(2048);
    expect(raster.height).toBe(4);
    expect(raster.rgba.length).toBe(2048 * 4 * 4);
  });
});

/* ------------------------------------------------------------------ */
/* Views and contact sheets                                            */
/* ------------------------------------------------------------------ */

describe('renderViews and contactSheet', () => {
  const mesh = tetrahedron();

  it('pairs every standard view with its own statistics', () => {
    const renders = renderViews(mesh, STANDARD_VIEWS, { width: 32, height: 32 });
    expect(renders.map((render) => render.view)).toEqual(['front', 'right', 'top', 'iso']);
    for (const render of renders) {
      expect(render.raster.width).toBe(32);
      expect(render.raster.height).toBe(32);
      expect(render.stats.width).toBe(32);
      // A solid subject is visible from all four of them. Something looking at
      // nothing is what a wrong view matrix produces, and it is what this
      // catches.
      expect(render.stats.blank).toBe(false);
    }
  });

  it('lays renders out in a grid of the expected size', () => {
    const renders = renderViews(mesh, STANDARD_VIEWS, { width: 32, height: 32 });
    const sheet = contactSheet(renders);
    // Two columns for four tiles: a 2px margin, two 32px tiles and one 1px rule.
    expect(sheet.width).toBe(2 * 2 + 2 * 32 + 1);
    expect(sheet.height).toBe(2 * 2 + 2 * 32 + 1);
    expect(imageStats(sheet).blank).toBe(false);

    const wide = contactSheet(renders, 4);
    // One row: the height drops by a tile and a rule.
    expect(wide.width).toBe(2 * 2 + 4 * 32 + 3);
    expect(wide.height).toBe(2 * 2 + 32);
    expect(imageStats(wide).blank).toBe(false);
  });

  it('lays mixed tile sizes out in the largest cell without rescaling them', () => {
    const sheet = contactSheet(
      [
        viewRenderOf('wide', createRaster(32, 12, [255, 0, 0, 255])),
        viewRenderOf('tall', createRaster(8, 24, [0, 255, 0, 255])),
      ],
      1,
    );
    // One column, two rows, cells as wide as the widest tile and as tall as the
    // tallest one — a 32x12 and an 8x24 give cells of 32x24.
    expect(sheet.width).toBe(2 * 2 + 32);
    expect(sheet.height).toBe(2 * 2 + 2 * 24 + 1);
    // The sheet's own background and the rule are visible around the tiles,
    // because a tile keeps its own size inside the cell rather than being
    // stretched into it.
    expect(imageStats(sheet).distinctColors).toBe(4);
  });

  it('has an answer for a sheet with no renders', () => {
    const empty = contactSheet([]);
    expect(empty.width).toBe(1);
    expect(imageStats(empty).blank).toBe(true);
  });
});
