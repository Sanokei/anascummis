/**
 * Pixels: PNG in and out, image statistics, and a small software rasteriser.
 *
 * This is the measuring instrument of the design harness. The harness authors a
 * picture as source, renders it, and then has to say something true about the
 * result. Part of that is only ever going to be an opinion from a vision model,
 * but a great deal of it is arithmetic — is the canvas blank, is content
 * running off the edge, is the contrast between the dominant colours adequate,
 * how many distinct colours does it actually use — and arithmetic settles a
 * criterion without asking a model to approve its own output.
 *
 * The rasteriser is here because a 3D asset has no browser to be rendered in:
 * workerd has no canvas and the harness runs with no network, so a scene has to
 * be drawn by us or not looked at all. It is deliberately not a game renderer.
 * Flat-shaded triangles, one directional light, no backface culling and no
 * anti-aliasing: every one of those simplifications is a defect made visible
 * rather than a corner cut, because a smooth render is a render that hides the
 * geometry errors this pass exists to catch.
 *
 * PNG is a real requirement and not a nicety: it is the only format the vision
 * path accepts that this runtime can produce without a browser. So it is
 * written and read here, in full, with no dependency beyond the platform's own
 * compression streams.
 */

import { fail, ok, type Result } from '../../shared/types';
import {
  boundsCenter,
  boundsFromPoints,
  clamp,
  contrastRatio,
  cross3,
  dot3,
  length3,
  normalize3,
  relativeLuminance,
  rgbToHex,
  sub3,
} from './math';
import type {
  ImageStats,
  Mesh,
  PaletteEntry,
  Raster,
  Vec3,
  ViewRender,
  ViewSpec,
} from './types';

/* ------------------------------------------------------------------ */
/* Limits and defaults                                                 */
/* ------------------------------------------------------------------ */

/**
 * The largest raster this module will allocate on a side when rendering.
 *
 * A 2048x2048 RGBA raster is 16 MB, which is a serious fraction of a Worker's
 * memory for one picture, and a contact sheet of four of them is past what the
 * isolate can hold at all. A view is a QA thumbnail, not a print: 512 is the
 * default and is enough for a vision model to see the shape of a defect, and a
 * caller that asks for more is clamped rather than trusted.
 */
export const MAX_VIEWPORT_SIDE = 2048;

/**
 * A ceiling on any raster this module allocates, in pixels. It exists so a
 * mistaken size fails loudly at the call rather than as an out-of-memory kill
 * somewhere in the isolate. A contact sheet of four full-size 2048 renders
 * needs 4098x4098 and will be refused, which is the honest answer: it cannot
 * be held.
 */
const MAX_RASTER_PIXELS = 4 * MAX_VIEWPORT_SIDE * MAX_VIEWPORT_SIDE;

const DEFAULT_VIEWPORT_SIDE = 512;

/**
 * The empty-canvas colour for a mesh render, and therefore the harness's
 * `background` in image statistics terms.
 *
 * A light neutral is chosen over the dark slate a viewport usually gets: the
 * shading model floors an unlit face at 0.18 of its base colour, so a mid-grey
 * part turned away from the light lands near 32/255 — invisible against a dark
 * background, and exactly the kind of "is that face there at all" question a
 * QA render is asked. The cost is the other end: a near-white material reads
 * faintly against it.
 */
const DEFAULT_BACKGROUND: [number, number, number, number] = [232, 234, 238, 255];

/** A light from above, in front and slightly to the right of the default view. */
const DEFAULT_LIGHT: Vec3 = [0.35, 0.75, 0.55];

/** Padding around the framed subject, as a fraction of the viewport per edge. */
const DEFAULT_PADDING = 0.06;
const MAX_PADDING = 0.4;

/**
 * How much of a face's base colour survives when no light reaches it. Small
 * enough to read as shadow, large enough that an unlit face is still a shape
 * rather than a hole in the picture.
 */
const AMBIENT = 0.18;

/**
 * Cosines within this of 1 mean the up vector is parallel to the view
 * direction. The cross product of parallel vectors is zero, and every
 * projected coordinate after it is NaN, so it is worth catching at ~0.8
 * degrees rather than at exactly parallel.
 */
const UP_PARALLEL_LIMIT = 0.9999;

/** Below this doubled screen area a triangle contributes less than a pixel. */
const MIN_DOUBLED_AREA = 1e-9;

/** How many palette entries `imageStats` reports at most. */
const PALETTE_LIMIT = 12;

/**
 * The ink coverage below which a canvas counts as blank. Chosen so that a
 * stray pixel or a hairline artefact does not pass for content.
 */
const BLANK_INK_THRESHOLD = 0.001;

/* ------------------------------------------------------------------ */
/* The raster itself                                                   */
/* ------------------------------------------------------------------ */

/**
 * A new raster, filled with `fill` (transparent black by default).
 *
 * Sizes are validated rather than clamped: `renderMesh` clamps its viewport,
 * because a render is a request for a picture of a thing and the caller's
 * number is a preference; a raster is a promise about how many bytes follow,
 * and silently resizing it would break that promise for whoever indexed it.
 */
export function createRaster(
  width: number,
  height: number,
  fill: [number, number, number, number] = [0, 0, 0, 0],
): Raster {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`A raster needs whole pixels on both sides; got ${width}x${height}.`);
  }
  const pixels = width * height;
  if (pixels > MAX_RASTER_PIXELS) {
    throw new RangeError(
      `A ${width}x${height} raster is ${pixels} pixels, past the ${MAX_RASTER_PIXELS} pixel ceiling this runtime can hold.`,
    );
  }
  const rgba = new Uint8ClampedArray(pixels * 4);
  const [r, g, b, a] = fill;
  // A new typed array is already zeroed, so the default transparent fill costs
  // nothing; only a real fill pays for the loop.
  if (r !== 0 || g !== 0 || b !== 0 || a !== 0) {
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = a;
    }
  }
  return { width, height, rgba };
}

/**
 * Writes one pixel. Coordinates are floored, so a fractional write lands on the
 * pixel containing it, and a write outside the canvas is ignored rather than
 * throwing: a drawing routine that runs a pixel past the edge should clip, not
 * abort the render it is part of.
 */
export function setPixel(r: Raster, x: number, y: number, rgba: [number, number, number, number]): void {
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px < 0 || py < 0 || px >= r.width || py >= r.height) return;
  const i = (py * r.width + px) * 4;
  r.rgba[i] = rgba[0];
  r.rgba[i + 1] = rgba[1];
  r.rgba[i + 2] = rgba[2];
  r.rgba[i + 3] = rgba[3];
}

/**
 * Reads one pixel, floored the same way. A read outside the canvas answers
 * transparent black — the same value an untouched pixel has — so a sampling
 * loop that strays past the edge sees "nothing here" rather than a crash.
 */
export function getPixel(r: Raster, x: number, y: number): [number, number, number, number] {
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px < 0 || py < 0 || px >= r.width || py >= r.height) return [0, 0, 0, 0];
  const i = (py * r.width + px) * 4;
  return [r.rgba[i] ?? 0, r.rgba[i + 1] ?? 0, r.rgba[i + 2] ?? 0, r.rgba[i + 3] ?? 0];
}

/* ------------------------------------------------------------------ */
/* Checksums                                                           */
/* ------------------------------------------------------------------ */

/**
 * The CRC-32 table PNG names in its specification (polynomial 0xedb88320,
 * reflected). Built once at module scope: the value is a pure function of the
 * byte index, and rebuilding 256 entries per chunk would cost nine times the
 * work of the checksum it exists to compute.
 *
 * The checksum covers the chunk *type* followed by the chunk *data*, and not
 * the length field in front of them. That is PNG's rule rather than a choice,
 * and getting it wrong produces a file that every decoder rejects.
 */
const CRC_TABLE = buildCrcTable();

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let bit = 0; bit < 8; bit++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

/** One step of CRC-32, so a checksum can be taken over several segments. */
function crc32Update(crc: number, bytes: Uint8Array): number {
  let c = crc;
  for (let i = 0; i < bytes.length; i++) {
    c = (CRC_TABLE[(c ^ (bytes[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return c;
}

/** CRC-32 of a chunk type and its data, the two things a PNG chunk checksums. */
function crc32OfChunk(type: string, data: Uint8Array): number {
  const typeBytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) typeBytes[i] = type.charCodeAt(i) & 0xff;
  const crc = crc32Update(crc32Update(0xffffffff, typeBytes), data);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Adler-32, the checksum zlib appends to its deflate stream. */
function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + (bytes[i] ?? 0)) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/* ------------------------------------------------------------------ */
/* PNG encoding                                                        */
/* ------------------------------------------------------------------ */

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The largest payload one stored deflate block can carry. */
const MAX_STORED_BLOCK = 65535;

/**
 * A zlib stream whose deflate payload is stored (uncompressed) blocks: two
 * bytes of header, five bytes per block plus the block's bytes, four bytes of
 * Adler-32.
 *
 * This is the always-available fallback for `CompressionStream`. It is larger
 * — a 512x512 render's IDAT is about a megabyte where the compressed path is
 * closer to a few kilobytes — but it is hand-writable, it cannot fail, and a
 * PNG with stored blocks is a conforming PNG: the specification constrains the
 * container, not the compression ratio. Bytes are cheaper than a corrupt file.
 *
 * The zlib wrapper is written here rather than delegated, because an IDAT
 * chunk is a zlib stream and not a bare deflate stream: handing raw deflate to
 * a decoder that expects the wrapper is the same class of mistake as emitting
 * nothing at all.
 */
export function deflateStored(raw: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(raw.length / MAX_STORED_BLOCK));
  const out = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  out[0] = 0x78; // CMF: deflate, 32K window.
  out[1] = 0x01; // FLG: no preset dictionary, fastest; (0x7801 % 31) === 0.
  let offset = 2;
  let position = 0;
  do {
    const length = Math.min(MAX_STORED_BLOCK, raw.length - position);
    const final = position + length >= raw.length;
    // BFINAL in bit 0 and BTYPE 00 in bits 1-2, so a final stored block's
    // first byte is 0x01 and a continuing one is 0x00.
    out[offset] = final ? 0x01 : 0x00;
    out[offset + 1] = length & 0xff;
    out[offset + 2] = (length >>> 8) & 0xff;
    // NLEN is LEN's one's complement, which is what lets a decoder resynchronise.
    out[offset + 3] = ~length & 0xff;
    out[offset + 4] = (~length >>> 8) & 0xff;
    out.set(raw.subarray(position, position + length), offset + 5);
    offset += 5 + length;
    position += length;
  } while (position < raw.length);
  const sum = adler32(raw);
  out[offset] = (sum >>> 24) & 0xff;
  out[offset + 1] = (sum >>> 16) & 0xff;
  out[offset + 2] = (sum >>> 8) & 0xff;
  out[offset + 3] = sum & 0xff;
  return out;
}

/**
 * Whether a stream starts the way zlib requires: compression method 8 in the
 * low nibble of CMF, and the two header bytes forming a multiple of 31.
 *
 * Worth checking before a compressed stream is trusted. An engine that emitted
 * raw deflate from `CompressionStream('deflate')` would produce an IDAT that no
 * decoder accepts, and the fallback costs only bytes, so the header is
 * verified rather than assumed.
 */
function isZlibStream(bytes: Uint8Array): boolean {
  const cmf = bytes[0];
  const flg = bytes[1];
  if (cmf === undefined || flg === undefined) return false;
  if ((cmf & 0x0f) !== 8) return false;
  return ((cmf << 8) | flg) % 31 === 0;
}

/** The platform's deflate, or null if it is absent or untrustworthy here. */
async function tryCompress(raw: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new CompressionStream('deflate');
    // The write runs concurrently with the read below. Awaiting the write
    // first would deadlock as soon as the transform's output queue filled and
    // the writer blocked waiting for a reader that had not started.
    let writeError: unknown = null;
    const writing = (async () => {
      const writer = stream.writable.getWriter();
      await writer.write(raw);
      await writer.close();
    })().catch((err: unknown) => {
      writeError = err;
    });

    const reader = stream.readable.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.length > 0) {
        chunks.push(value);
        total += value.length;
      }
    }
    await writing;
    if (writeError) return null;

    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunkBytes of chunks) {
      out.set(chunkBytes, offset);
      offset += chunkBytes.length;
    }
    return out;
  } catch {
    return null;
  }
}

/** Deflated scanlines, in the zlib wrapper an IDAT chunk requires. */
async function deflateZlib(raw: Uint8Array): Promise<Uint8Array> {
  const compressed = await tryCompress(raw);
  if (compressed && isZlibStream(compressed)) return compressed;
  return deflateStored(raw);
}

function writeUint32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function readUint32(source: Uint8Array, offset: number): number {
  const b0 = source[offset] ?? 0;
  const b1 = source[offset + 1] ?? 0;
  const b2 = source[offset + 2] ?? 0;
  const b3 = source[offset + 3] ?? 0;
  return ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
}

function readChunkType(source: Uint8Array, offset: number): string {
  return String.fromCharCode(
    source[offset] ?? 0,
    source[offset + 1] ?? 0,
    source[offset + 2] ?? 0,
    source[offset + 3] ?? 0,
  );
}

/** Length, type, data, CRC — the whole PNG chunk format. */
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  writeUint32(out, 0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i) & 0xff;
  out.set(data, 8);
  writeUint32(out, 8 + data.length, crc32OfChunk(type, data));
  return out;
}

/**
 * Encodes a raster as an 8-bit RGBA PNG: signature, IHDR, one IDAT, IEND, no
 * interlace and no ancillary chunks.
 *
 * Scanlines are filtered with type 0 (None). The alternative is an adaptive
 * per-row choice, which costs a pass over every row to pick a filter and a
 * second pass to apply it, and buys compression only on photographic input —
 * the rasteriser's output is flat-shaded polygons with large uniform runs,
 * which deflate already collapses. Type 0 also means the filter bytes are
 * trivially checkable when a decoder is suspect, which matters more here than
 * the last few percent of size.
 *
 * Throws on a raster whose data does not match its declared size, because the
 * alternative is writing an IHDR that lies about the bytes behind it.
 */
export async function encodePng(raster: Raster): Promise<Uint8Array> {
  const { width, height, rgba } = raster;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`A PNG needs whole pixels on both sides; got ${width}x${height}.`);
  }
  const stride = width * 4;
  if (rgba.length !== stride * height) {
    throw new RangeError(
      `A ${width}x${height} raster needs ${stride * height} bytes and carries ${rgba.length}.`,
    );
  }

  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    const target = y * (stride + 1);
    raw[target] = 0; // Filter type 0, None.
    raw.set(rgba.subarray(rowStart, rowStart + stride), target + 1);
  }

  const header = new Uint8Array(13);
  writeUint32(header, 0, width);
  writeUint32(header, 4, height);
  header[8] = 8; // Bit depth.
  header[9] = 6; // Colour type 6, truecolour with alpha.
  header[10] = 0; // Compression method, only deflate is defined.
  header[11] = 0; // Filter method, only the five filters below are defined.
  header[12] = 0; // Interlace method, 0 = none.

  const idat = await deflateZlib(raw);
  const parts = [
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', idat),
    pngChunk('IEND', new Uint8Array(0)),
  ];
  let total = 0;
  for (const part of parts) total += part.length;
  const png = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

/* ------------------------------------------------------------------ */
/* PNG decoding                                                        */
/* ------------------------------------------------------------------ */

interface PngHeader {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
}

/**
 * Reads a PNG back: 8-bit greyscale, truecolour, palette, greyscale+alpha and
 * truecolour+alpha, non-interlaced, which covers what this module writes and
 * what Cloudflare Browser Rendering returns.
 *
 * The two things it refuses rather than guesses at are interlacing and any bit
 * depth other than 8. Both are readable in principle and neither is worth a
 * wrong picture: Adam7 reorders the scanlines, so a decoder that ignores it
 * produces a plausible-looking image with its pixels in the wrong places, and
 * sub-byte samples shift every channel. A refusal a caller can act on beats a
 * picture everyone will believe.
 */
export async function decodePng(bytes: Uint8Array): Promise<Result<Raster>> {
  if (bytes.length < PNG_SIGNATURE.length) {
    return fail('invalid-argument', 'The file is shorter than a PNG signature.');
  }
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if ((bytes[i] ?? 0) !== (PNG_SIGNATURE[i] ?? 0)) {
      return fail('invalid-argument', `The PNG signature is wrong at byte ${i}.`);
    }
  }

  let header: PngHeader | null = null;
  const idatParts: Uint8Array[] = [];
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  let sawEnd = false;

  let offset = PNG_SIGNATURE.length;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) {
      return fail('invalid-argument', `The file ends inside a chunk header at byte ${offset}.`);
    }
    const length = readUint32(bytes, offset);
    const type = readChunkType(bytes, offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) {
      return fail(
        'invalid-argument',
        `The ${type} chunk claims ${length} bytes, which runs past the end of the file.`,
      );
    }
    const stored = readUint32(bytes, dataEnd);
    const computed = crc32OfChunk(type, bytes.subarray(dataStart, dataEnd));
    if (stored !== computed) {
      return fail(
        'invalid-argument',
        `The ${type} chunk fails its CRC check: the file says ${stored}, the bytes are ${computed}.`,
      );
    }
    const data = bytes.subarray(dataStart, dataEnd);

    switch (type) {
      case 'IHDR': {
        if (header) return fail('invalid-argument', 'The file has more than one IHDR chunk.');
        if (length !== 13) return fail('invalid-argument', `IHDR is ${length} bytes, not 13.`);
        const parsed: PngHeader = {
          width: readUint32(data, 0),
          height: readUint32(data, 4),
          bitDepth: data[8] ?? 0,
          colorType: data[9] ?? 0,
        };
        if (parsed.width <= 0 || parsed.height <= 0) {
          return fail('invalid-argument', `IHDR declares a ${parsed.width}x${parsed.height} image.`);
        }
        const compression = data[10] ?? 0;
        const filterMethod = data[11] ?? 0;
        const interlace = data[12] ?? 0;
        if (compression !== 0 || filterMethod !== 0) {
          return fail(
            'invalid-argument',
            `IHDR names compression ${compression} and filter method ${filterMethod}; only 0 is defined.`,
          );
        }
        if (interlace === 1) {
          return fail(
            'unsupported-runtime',
            'This PNG is Adam7-interlaced, which this decoder does not implement. It could return a picture with the pixels in the wrong order, and a wrong picture is worse than none.',
          );
        }
        if (interlace !== 0) return fail('invalid-argument', `IHDR names interlace method ${interlace}.`);
        if (parsed.bitDepth !== 8) {
          return fail(
            'unsupported-runtime',
            `This PNG has ${parsed.bitDepth}-bit samples; only 8-bit is implemented, and unpacking sub-byte samples would need the shifts that make a wrong picture look right.`,
          );
        }
        if (parsed.colorType !== 0 && parsed.colorType !== 2 && parsed.colorType !== 3 && parsed.colorType !== 4 && parsed.colorType !== 6) {
          return fail('invalid-argument', `IHDR names colour type ${parsed.colorType}, which PNG does not define.`);
        }
        header = parsed;
        break;
      }
      case 'PLTE': {
        if (palette) return fail('invalid-argument', 'The file has more than one PLTE chunk.');
        if (length === 0 || length % 3 !== 0 || length > 768) {
          return fail('invalid-argument', `PLTE is ${length} bytes, which is not 1 to 256 entries of three.`);
        }
        palette = data;
        break;
      }
      case 'tRNS':
        transparency = data;
        break;
      case 'IDAT':
        idatParts.push(data);
        break;
      case 'IEND':
        sawEnd = true;
        break;
      default:
        // Ancillary chunks (gAMA, tEXt, pHYs and the rest) do not affect the
        // pixels, so they are skipped rather than rejected: Browser Rendering
        // emits several of them.
        break;
    }

    offset = dataEnd + 4;
    if (sawEnd) break;
  }

  if (!header) return fail('invalid-argument', 'The file has no IHDR chunk.');
  if (!sawEnd) return fail('invalid-argument', 'The file ends without an IEND chunk.');
  if (idatParts.length === 0) return fail('invalid-argument', 'The file has no IDAT chunk.');

  if (header.colorType === 3 && !palette) {
    return fail('invalid-argument', 'An indexed PNG needs a PLTE chunk, and this one has none.');
  }
  // tRNS names one transparent colour for greyscale and truecolour images. It
  // is rare, it is not what Browser Rendering produces, and ignoring it would
  // return a fully opaque picture of a partly transparent one, so it is
  // refused instead.
  if (transparency && (header.colorType === 0 || header.colorType === 2)) {
    return fail(
      'unsupported-runtime',
      'This PNG carries a tRNS chunk on a greyscale or truecolour image, which is not implemented; decoding it as opaque would misreport the image.',
    );
  }

  const inflated = await inflateZlib(idatParts);
  if (!inflated.ok) return inflated;

  const channels = channelsFor(header.colorType);
  const expected = (header.width * channels + 1) * header.height;
  if (inflated.value.length < expected) {
    return fail(
      'invalid-argument',
      `The image data is ${inflated.value.length} bytes where the header promises ${expected}.`,
    );
  }

  const samples = unfilter(inflated.value, header.width, header.height, channels);
  if (!samples.ok) return samples;

  return expandToRgba(samples.value, header, palette, transparency);
}

/** Bytes per pixel, which is also the offset the Sub/Average/Paeth filters use. */
function channelsFor(colorType: number): number {
  switch (colorType) {
    case 0:
      return 1;
    case 2:
      return 3;
    case 3:
      return 1;
    case 4:
      return 2;
    default:
      return 4;
  }
}

async function inflateZlib(parts: Uint8Array[]): Promise<Result<Uint8Array>> {
  if (typeof DecompressionStream === 'undefined') {
    return fail('unsupported-runtime', 'This runtime has no DecompressionStream, so a PNG cannot be decompressed.');
  }
  let total = 0;
  for (const part of parts) total += part.length;
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }

  try {
    const stream = new DecompressionStream('deflate');
    let writeError: unknown = null;
    const writing = (async () => {
      const writer = stream.writable.getWriter();
      await writer.write(joined);
      await writer.close();
    })().catch((err: unknown) => {
      writeError = err;
    });

    const reader = stream.readable.getReader();
    const chunks: Uint8Array[] = [];
    let produced = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.length > 0) {
        chunks.push(value);
        produced += value.length;
      }
    }
    await writing;
    if (writeError) {
      return fail('invalid-argument', `The IDAT stream is not readable deflate data: ${String(writeError)}`);
    }
    const out = new Uint8Array(produced);
    let at = 0;
    for (const chunkBytes of chunks) {
      out.set(chunkBytes, at);
      at += chunkBytes.length;
    }
    return ok(out);
  } catch (err) {
    return fail('invalid-argument', `The IDAT stream is not readable deflate data: ${String(err)}`);
  }
}

/** The PNG Paeth predictor: whichever of left, above and upper-left is closest. */
function paeth(left: number, up: number, upperLeft: number): number {
  const p = left + up - upperLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upperLeft);
  if (pa <= pb && pa <= pc) return left;
  if (pb <= pc) return up;
  return upperLeft;
}

/**
 * Undoes the per-row filtering, in place conceptually: each row's bytes are
 * deltas against the reconstructed pixels to its left and the reconstructed row
 * above, so the loop must write as it reads and must read the row it has
 * already rebuilt rather than the file's bytes.
 */
function unfilter(
  raw: Uint8Array,
  width: number,
  height: number,
  channels: number,
): Result<Uint8Array> {
  const rowBytes = width * channels;
  const out = new Uint8Array(rowBytes * height);
  let position = 0;
  for (let y = 0; y < height; y++) {
    const filterType = raw[position] ?? 0;
    position += 1;
    const rowStart = y * rowBytes;
    const aboveStart = rowStart - rowBytes;
    for (let x = 0; x < rowBytes; x++) {
      const value = raw[position + x] ?? 0;
      const left = x >= channels ? (out[rowStart + x - channels] ?? 0) : 0;
      const up = y > 0 ? (out[aboveStart + x] ?? 0) : 0;
      const upperLeft = y > 0 && x >= channels ? (out[aboveStart + x - channels] ?? 0) : 0;
      let reconstructed: number;
      switch (filterType) {
        case 0:
          reconstructed = value;
          break;
        case 1:
          reconstructed = value + left;
          break;
        case 2:
          reconstructed = value + up;
          break;
        case 3:
          reconstructed = value + ((left + up) >> 1);
          break;
        case 4:
          reconstructed = value + paeth(left, up, upperLeft);
          break;
        default:
          return fail('invalid-argument', `Row ${y} uses filter type ${filterType}, which PNG does not define.`);
      }
      out[rowStart + x] = reconstructed & 0xff;
    }
    position += rowBytes;
  }
  return ok(out);
}

/** Samples to RGBA, per colour type. */
function expandToRgba(
  samples: Uint8Array,
  header: PngHeader,
  palette: Uint8Array | null,
  transparency: Uint8Array | null,
): Result<Raster> {
  const { width, height, colorType } = header;
  const pixels = width * height;
  const rgba = new Uint8ClampedArray(pixels * 4);

  switch (colorType) {
    case 0:
      for (let i = 0; i < pixels; i++) {
        const grey = samples[i] ?? 0;
        const at = i * 4;
        rgba[at] = grey;
        rgba[at + 1] = grey;
        rgba[at + 2] = grey;
        rgba[at + 3] = 255;
      }
      break;
    case 2:
      for (let i = 0; i < pixels; i++) {
        const from = i * 3;
        const at = i * 4;
        rgba[at] = samples[from] ?? 0;
        rgba[at + 1] = samples[from + 1] ?? 0;
        rgba[at + 2] = samples[from + 2] ?? 0;
        rgba[at + 3] = 255;
      }
      break;
    case 3: {
      if (!palette) return fail('invalid-argument', 'An indexed PNG needs a PLTE chunk, and this one has none.');
      const entries = Math.floor(palette.length / 3);
      for (let i = 0; i < pixels; i++) {
        const index = samples[i] ?? 0;
        if (index >= entries) {
          return fail('invalid-argument', `Pixel ${i} uses palette index ${index}, past the ${entries} entries in PLTE.`);
        }
        const from = index * 3;
        const at = i * 4;
        rgba[at] = palette[from] ?? 0;
        rgba[at + 1] = palette[from + 1] ?? 0;
        rgba[at + 2] = palette[from + 2] ?? 0;
        const alpha = transparency?.[index];
        rgba[at + 3] = alpha === undefined ? 255 : alpha;
      }
      break;
    }
    case 4:
      for (let i = 0; i < pixels; i++) {
        const from = i * 2;
        const at = i * 4;
        const grey = samples[from] ?? 0;
        rgba[at] = grey;
        rgba[at + 1] = grey;
        rgba[at + 2] = grey;
        rgba[at + 3] = samples[from + 1] ?? 0;
      }
      break;
    default:
      // Colour type 6, checked by the header parse before reaching here.
      for (let i = 0; i < pixels * 4; i++) rgba[i] = samples[i] ?? 0;
      break;
  }
  return ok({ width, height, rgba });
}

/* ------------------------------------------------------------------ */
/* Image statistics                                                    */
/* ------------------------------------------------------------------ */

/**
 * Everything measurable about a rendered picture, in one pass over the pixels.
 *
 * Fully transparent pixels are excluded from every colour statistic: an
 * untouched corner of an SVG render is not a colour the drawing uses, and
 * counting it would make the empty part of a canvas its dominant "colour".
 *
 * They are *not* excluded from the coverage fractions. A pixel that is not the
 * background colour is ink, and a transparent pixel is not the background, so
 * a background rectangle that stops short of the canvas edge shows up as edge
 * coverage — which is the defect `edgeCoverage` exists to report.
 *
 * With nothing drawn at all there is no background to differ from, so the
 * coverage fractions are 0 and the emptiness is carried by `blank`,
 * `distinctColors` and a zero `backgroundShare` rather than by a fabricated
 * colour.
 */
export function imageStats(raster: Raster): ImageStats {
  const { width, height, rgba } = raster;
  const pixels = width * height;

  // Colours are keyed by all four channels packed into one number: the same hue
  // at two different alphas is two different colours, and merging them would
  // overstate the share of whichever was drawn first. Insertion order is scan
  // order, and Map preserves it for numeric keys, which is what makes the tie
  // breaking below deterministic.
  const counts = new Map<number, number>();
  const borderCounts = new Map<number, number>();
  let borderPixels = 0;
  let drawn = 0;
  let luminanceSum = 0;

  for (let y = 0; y < height; y++) {
    const edgeRow = y === 0 || y === height - 1;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = rgba[i] ?? 0;
      const g = rgba[i + 1] ?? 0;
      const b = rgba[i + 2] ?? 0;
      const a = rgba[i + 3] ?? 0;
      const onBorder = edgeRow || x === 0 || x === width - 1;
      if (onBorder) borderPixels += 1;
      if (a === 0) continue;
      const key = ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      drawn += 1;
      luminanceSum += relativeLuminance(r, g, b);
      if (onBorder) borderCounts.set(key, (borderCounts.get(key) ?? 0) + 1);
    }
  }

  if (drawn === 0) {
    return {
      width,
      height,
      distinctColors: 0,
      background: '#000000',
      backgroundShare: 0,
      palette: [],
      edgeCoverage: 0,
      contrastRatio: 1,
      meanLuminance: 0,
      blank: true,
      inkCoverage: 0,
    };
  }

  // Ties go to the colour that appears first in scan order: the comparison is
  // strict, so the earliest colour with the highest count wins and two runs
  // over the same pixels can never disagree about which colour is the
  // background.
  let backgroundKey = 0;
  let backgroundCount = 0;
  for (const [key, count] of counts) {
    if (count > backgroundCount) {
      backgroundKey = key;
      backgroundCount = count;
    }
  }

  const entries: { key: number; count: number }[] = [];
  for (const [key, count] of counts) entries.push({ key, count });
  // Descending by count. The sort is stable, so equal counts keep scan order,
  // which is what lets `entries[1]` be read as the most common colour that is
  // not the background.
  entries.sort((a, b) => b.count - a.count);

  const palette: PaletteEntry[] = [];
  for (const entry of entries.slice(0, PALETTE_LIMIT)) {
    palette.push({
      hex: rgbToHex((entry.key >>> 24) & 0xff, (entry.key >>> 16) & 0xff, (entry.key >>> 8) & 0xff),
      share: entry.count / drawn,
    });
  }

  const background: [number, number, number] = [
    (backgroundKey >>> 24) & 0xff,
    (backgroundKey >>> 16) & 0xff,
    (backgroundKey >>> 8) & 0xff,
  ];
  const second = entries[1];
  const contrast = second
    ? contrastRatio(background, [
        (second.key >>> 24) & 0xff,
        (second.key >>> 16) & 0xff,
        (second.key >>> 8) & 0xff,
      ])
    : 1;

  const inkCoverage = pixels > 0 ? (pixels - backgroundCount) / pixels : 0;
  const borderBackground = borderCounts.get(backgroundKey) ?? 0;
  const edgeCoverage = borderPixels > 0 ? (borderPixels - borderBackground) / borderPixels : 0;

  return {
    width,
    height,
    distinctColors: counts.size,
    background: rgbToHex(background[0], background[1], background[2]),
    backgroundShare: pixels > 0 ? backgroundCount / pixels : 0,
    palette,
    edgeCoverage,
    contrastRatio: contrast,
    meanLuminance: luminanceSum / drawn,
    blank: counts.size < 2 || inkCoverage < BLANK_INK_THRESHOLD,
    inkCoverage,
  };
}

/* ------------------------------------------------------------------ */
/* The rasteriser                                                      */
/* ------------------------------------------------------------------ */

export interface RenderOptions {
  width?: number;
  height?: number;
  background?: [number, number, number, number];
  /** Direction the light comes *from*, in world space. */
  light?: Vec3;
  /** Orthographic by default; a perspective factor of 0 keeps it orthographic. */
  perspective?: number;
  /** Draw triangle edges in this colour when set. */
  wireframe?: [number, number, number];
  /** Padding around the framed subject, 0..0.4. */
  padding?: number;
}

function viewportSide(requested: number | undefined, fallback: number): number {
  const value = requested ?? fallback;
  if (!Number.isFinite(value)) return fallback;
  return clamp(Math.round(value), 1, MAX_VIEWPORT_SIDE);
}

interface CameraAxes {
  forward: Vec3;
  right: Vec3;
  up: Vec3;
}

/**
 * The camera's three axes, from a direction and an up vector.
 *
 * The offset's *length* is not part of this: the subject is auto-framed, so a
 * camera further away would produce exactly the same picture unless the caller
 * asked for perspective, where the length is the camera distance. Only its
 * direction is used here.
 */
function cameraAxes(view: ViewSpec): CameraAxes {
  // A camera sitting exactly on its target has no view direction. Falling back
  // to a front view keeps the render total, and a picture from a default
  // direction reports a caller's mistake more usefully than a blank canvas
  // would.
  const direction = normalize3(view.offset) ?? ([0, 0, 1] as Vec3);
  const forward: Vec3 = [-direction[0], -direction[1], -direction[2]];

  // The up vector must not be parallel to the view direction: their cross
  // product is the screen's right axis, and a zero cross product turns every
  // projected coordinate into NaN. The caller's up is used when it is usable;
  // otherwise the world axes are tried in turn, which always finds one because
  // no two of them are parallel to each other, let alone both parallel to the
  // same direction.
  const up = resolveUp(view.up, forward);

  // Non-degenerate by the construction of `up`, which is the whole reason it
  // was chosen that way; the fallback is what lets this return without an
  // assertion, and it is unreachable for a finite view direction.
  const right = normalize3(cross3(forward, up)) ?? ([1, 0, 0] as Vec3);
  const screenUp = cross3(right, forward);
  return { forward, right, up: screenUp };
}

function resolveUp(candidate: Vec3, forward: Vec3): Vec3 {
  const options: Vec3[] = [candidate, [0, 1, 0], [0, 0, 1], [1, 0, 0]];
  for (const option of options) {
    const unit = normalize3(option);
    if (unit && Math.abs(dot3(unit, forward)) < UP_PARALLEL_LIMIT) return unit;
  }
  return [0, 1, 0];
}

/**
 * Draws a mesh: orthographic by default, z-buffered, flat-shaded.
 *
 * Three decisions are worth stating because they are the difference between a
 * QA render and a pretty one.
 *
 * Auto-framing. After transforming to view space the projected bounds of every
 * visible vertex are measured and a scale is chosen so the subject fits the
 * viewport with `padding` at each edge. A caller therefore does not have to
 * know how big the mesh is to compare two views of it, and the four standard
 * views of one mesh are directly comparable because each is framed on the same
 * subject rather than on a camera distance someone guessed.
 *
 * No backface culling. An inverted winding is a real defect — a face that is
 * lit from behind, a part that vanishes when the model is rotated — and culling
 * is precisely the mechanism that would hide it. Drawing both sides costs fill
 * rate and nothing else, since the z-buffer resolves the overlap anyway.
 *
 * A z-buffer rather than painter's order. Overlapping triangles come out the
 * same whichever order the mesh lists them in, which matters because the scene
 * module's ordering is not something a reviewer can be asked to reason about.
 *
 * A camera with a position. The offset's length places the eye, and geometry at
 * or behind it is not drawn, under either projection: an orthographic render of
 * a subject the camera is standing inside would otherwise show the far side
 * through the near one with the depth order reversed, which is the kind of
 * confidently wrong picture this harness exists to avoid. The cost is that an
 * offset short enough to be inside the subject cuts it, so the standard views
 * stand well back.
 *
 * Translucent triangles are depth-tested like opaque ones rather than
 * composited, so a face with opacity below 1 hides what is behind it. That is a
 * limitation, stated because the alternative — blending without sorting — would
 * be a picture that depends on triangle order.
 *
 * Throws a RangeError if a triangle names a vertex the mesh does not have. A
 * mesh with dangling indices is not a picture with a defect in it, it is an
 * unusable input, and drawing the rest of it would quietly understate the
 * subject.
 */
export function renderMesh(mesh: Mesh, view: ViewSpec, options: RenderOptions = {}): Raster {
  const width = viewportSide(options.width, DEFAULT_VIEWPORT_SIDE);
  const height = viewportSide(options.height, DEFAULT_VIEWPORT_SIDE);
  const raster = createRaster(width, height, options.background ?? DEFAULT_BACKGROUND);
  if (mesh.positions.length === 0 || mesh.triangles.length === 0) return raster;

  const bounds = boundsFromPoints(mesh.positions);
  if (!bounds) return raster;
  const centre = boundsCenter(bounds);
  const axes = cameraAxes(view);

  // The offset's length is the camera's distance from the subject, and it
  // matters to both projections. It is what makes "behind the camera" mean
  // something: geometry at or behind the eye plane is not drawn, because a
  // depth ordering measured from a camera is only meaningful in front of it,
  // and geometry behind the eye would otherwise occlude — with the ordering
  // inverted — the geometry the camera can actually see. An offset with no
  // length names a direction and no position, so there is no eye plane to be
  // behind and the render is a pure orthographic projection of the whole mesh.
  const offsetLength = length3(view.offset);
  const eyeDistance = Number.isFinite(offsetLength) && offsetLength > 0 ? offsetLength : 0;

  // Perspective is a blend, not a switch: 0 is orthographic and 1 is a true
  // pinhole at that distance, with the projected position interpolated between
  // the two. It is ignored when there is no camera position to have a pinhole
  // at.
  const perspective = eyeDistance > 0 ? clamp(options.perspective ?? 0, 0, 1) : 0;

  const count = mesh.positions.length;
  const projectedX = new Float64Array(count);
  const projectedY = new Float64Array(count);
  const viewDepth = new Float64Array(count);
  const screenX = new Float64Array(count);
  const screenY = new Float64Array(count);
  // Zero means "not projectable", which is the initial state of every vertex:
  // then a vertex only has to be marked visible once it is through the divide.
  const visible = new Uint8Array(count);

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let nearDepth = Infinity;
  let farDepth = -Infinity;

  for (let i = 0; i < count; i++) {
    const point = mesh.positions[i];
    if (!point) continue;
    const relative = sub3(point, centre);
    const x = dot3(relative, axes.right);
    const y = dot3(relative, axes.up);
    const z = dot3(relative, axes.forward);
    viewDepth[i] = z;

    let px = x;
    let py = y;
    if (eyeDistance > 0) {
      // Distance along the view axis measured from the eye, which sits at
      // -eyeDistance. This is the only place the camera's position enters the
      // projection.
      const distance = z + eyeDistance;
      // At or behind the eye plane. There is no projection of a point behind
      // the camera, and the subject's depth ordering stops being meaningful
      // there, so it is dropped rather than mirrored into the frame.
      if (distance <= 0) continue;
      if (perspective > 0) {
        const mix = 1 - perspective + (perspective * eyeDistance) / distance;
        px = x * mix;
        py = y * mix;
      }
    }

    visible[i] = 1;
    projectedX[i] = px;
    projectedY[i] = py;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
    if (z < nearDepth) nearDepth = z;
    if (z > farDepth) farDepth = z;
  }

  // Nothing projected: an empty mesh, or geometry entirely behind the eye. The
  // background is the whole answer.
  if (minX > maxX || minY > maxY) return raster;

  const padding = clamp(options.padding ?? DEFAULT_PADDING, 0, MAX_PADDING);
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const usableWidth = width * (1 - 2 * padding);
  const usableHeight = height * (1 - 2 * padding);
  const fit = Math.min(
    spanX > 0 ? usableWidth / spanX : Infinity,
    spanY > 0 ? usableHeight / spanY : Infinity,
  );
  // A mesh that projects to a point has nothing to frame or to draw a scale
  // from; 1 puts it in the centre of the viewport, which is where a point
  // belongs. NaN bounds land here too, and stop at this line rather than
  // spreading through every screen coordinate.
  const scale = Number.isFinite(fit) ? fit : 1;
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;

  for (let i = 0; i < count; i++) {
    if (!visible[i]) continue;
    // Image rows run downwards, so the vertical axis is negated here and
    // nowhere else.
    screenX[i] = width / 2 + ((projectedX[i] ?? 0) - midX) * scale;
    screenY[i] = height / 2 - ((projectedY[i] ?? 0) - midY) * scale;
  }

  const depthBuffer = new Float64Array(width * height).fill(Infinity);
  // A wireframe edge carries the same depth as the surface it bounds, and the
  // two arrive at a pixel by different arithmetic, so an edge needs a little
  // room or a triangle's own fill swallows it. Scaled to the subject's depth so
  // it does not depend on the units the mesh is written in.
  const depthTolerance = Math.max(1e-9, (farDepth - nearDepth) * 1e-6);

  const light = normalize3(options.light ?? DEFAULT_LIGHT);
  const wire = options.wireframe;
  const wireColour: [number, number, number, number] = wire ? [wire[0], wire[1], wire[2], 255] : [0, 0, 0, 0];

  // A zero-length light is a request for no light, and every face falls to the
  // ambient floor. It is not an error and it is not silently replaced.
  const lambertOf = (normal: Vec3): number => (light ? Math.max(0, dot3(normal, light)) : 0);

  const plot = (px: number, py: number, z: number): void => {
    if (px < 0 || py < 0 || px >= width || py >= height) return;
    const index = py * width + px;
    if (z > (depthBuffer[index] ?? Infinity) + depthTolerance) return;
    setPixel(raster, px, py, wireColour);
  };

  const drawEdge = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)));
    if (steps <= 0) {
      plot(Math.round(x0), Math.round(y0), z0);
      return;
    }
    for (let step = 0; step <= steps; step++) {
      const t = step / steps;
      plot(Math.round(x0 + dx * t), Math.round(y0 + dy * t), z0 + (z1 - z0) * t);
    }
  };

  for (let t = 0; t < mesh.triangles.length; t++) {
    const triangle = mesh.triangles[t];
    if (!triangle) continue;
    const ia = triangle.a;
    const ib = triangle.b;
    const ic = triangle.c;
    const a = mesh.positions[ia];
    const b = mesh.positions[ib];
    const c = mesh.positions[ic];
    if (!a || !b || !c) {
      throw new RangeError(
        `Triangle ${t} of part "${triangle.part}" names a vertex that is not in the mesh.`,
      );
    }
    // A triangle with any vertex behind the eye plane is dropped whole. Proper
    // near-plane clipping would need a polygon clipper for the one case a QA
    // render never wants — a camera inside the subject — and a truncated
    // triangle would be a lie about the geometry.
    if (!visible[ia] || !visible[ib] || !visible[ic]) continue;

    const ax = screenX[ia] ?? 0;
    const ay = screenY[ia] ?? 0;
    const az = viewDepth[ia] ?? 0;
    const bx = screenX[ib] ?? 0;
    const by = screenY[ib] ?? 0;
    const bz = viewDepth[ib] ?? 0;
    const cx = screenX[ic] ?? 0;
    const cy = screenY[ic] ?? 0;
    const cz = viewDepth[ic] ?? 0;

    // Twice the signed screen area. Zero means the triangle covers no pixel
    // centre at all, and it is also the divisor the barycentric weights use, so
    // this is the check that keeps that division finite. The epsilon catches
    // slivers a hundredth of a pixel across, which cost a full bounding-box
    // loop to deposit nothing.
    const doubledArea = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (!Number.isFinite(doubledArea) || Math.abs(doubledArea) < MIN_DOUBLED_AREA) continue;

    // Lambert plus the ambient floor, multiplied into the base colour and
    // clamped by the raster's own channel type. The sum can pass 1, so a face
    // lit head-on saturates: that is the cost of keeping the unlit floor at
    // exactly AMBIENT times the base rather than compressing the whole range
    // into the unit interval, and it is the cheaper loss of the two on a
    // render whose job is to show which faces are lit.
    const intensity = AMBIENT + lambertOf(triangle.normal);
    const shaded: [number, number, number, number] = [
      triangle.color[0] * intensity,
      triangle.color[1] * intensity,
      triangle.color[2] * intensity,
      clamp(triangle.opacity, 0, 1) * 255,
    ];

    let left = Math.floor(Math.min(ax, bx, cx));
    let right = Math.ceil(Math.max(ax, bx, cx));
    let top = Math.floor(Math.min(ay, by, cy));
    let bottom = Math.ceil(Math.max(ay, by, cy));
    if (left < 0) left = 0;
    if (top < 0) top = 0;
    if (right > width - 1) right = width - 1;
    if (bottom > height - 1) bottom = height - 1;

    const inverseArea = 1 / doubledArea;
    for (let py = top; py <= bottom; py++) {
      const sampleY = py + 0.5;
      const rowOffset = py * width;
      for (let px = left; px <= right; px++) {
        const sampleX = px + 0.5;
        // Dividing by the signed area is what makes the inside test
        // winding-independent: a triangle wound the other way has a negative
        // area, and the weights come back positive for interior points either
        // way. Nothing is culled here.
        const w0 = ((cx - bx) * (sampleY - by) - (cy - by) * (sampleX - bx)) * inverseArea;
        const w1 = ((ax - cx) * (sampleY - cy) - (ay - cy) * (sampleX - cx)) * inverseArea;
        const w2 = ((bx - ax) * (sampleY - ay) - (by - ay) * (sampleX - ax)) * inverseArea;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        // Linear in the barycentric weights, which is exact for an orthographic
        // projection and an approximation under perspective, where the correct
        // depth is the reciprocal of a linear function. The consequence is a
        // z-buffer that is very slightly off between two triangles meeting at a
        // steep angle under perspective, and it is not worth a divide per pixel
        // to correct on a QA thumbnail.
        const z = w0 * az + w1 * bz + w2 * cz;
        const index = rowOffset + px;
        if (z < (depthBuffer[index] ?? Infinity)) {
          depthBuffer[index] = z;
          setPixel(raster, px, py, shaded);
        }
      }
    }

    if (wire) {
      // Drawn through the same depth test, so an edge on the far side of the
      // subject is hidden by the surface in front of it: a wireframe that shone
      // through the model would make the picture harder to read, not easier.
      drawEdge(ax, ay, az, bx, by, bz);
      drawEdge(bx, by, bz, cx, cy, cz);
      drawEdge(cx, cy, cz, ax, ay, az);
    }
  }

  return raster;
}

/** Renders each view and measures it, which is what a review round consumes. */
export function renderViews(mesh: Mesh, views: ViewSpec[], options: RenderOptions = {}): ViewRender[] {
  return views.map((view) => {
    const raster = renderMesh(mesh, view, options);
    return { view: view.name, raster, stats: imageStats(raster) };
  });
}

/* ------------------------------------------------------------------ */
/* Contact sheet                                                       */
/* ------------------------------------------------------------------ */

/**
 * The sheet's own background, and the rules between tiles.
 *
 * The separator is darker than both the sheet and the default render
 * background so a tile boundary survives a vision model's downscaling — a 1px
 * line can vanish under resampling, and the sheet also keeps the tiles' own
 * backgrounds distinct so a boundary is never only the rule.
 */
const SHEET_BACKGROUND: [number, number, number, number] = [248, 248, 250, 255];
const SHEET_SEPARATOR: [number, number, number, number] = [80, 80, 84, 255];
const SHEET_MARGIN = 2;
const TILE_GAP = 1;

/**
 * Lays renders out in a grid, `columns` across.
 *
 * Tiles are placed, never resampled: a scaled tile would blur exactly the
 * hairlines and one-pixel misalignments a review is looking for. Mixed tile
 * sizes are laid out in the largest cell, so an unusual view does not overlap
 * its neighbours.
 *
 * There are no titles, and that is deliberate. There is no font here and
 * drawing one would be a project of its own; more to the point, the sheet is
 * handed to a vision model with the views described in order, so the order of
 * the tiles is the labelling. The margin and the rules exist so the grid reads
 * as several pictures rather than one.
 *
 * The sheet is one allocation of the tiles' combined size, so four full-size
 * 2048 renders cannot be assembled at all; `createRaster` refuses that rather
 * than letting the isolate die trying.
 */
export function contactSheet(renders: ViewRender[], columns?: number): Raster {
  const count = renders.length;
  // No tiles, no grid. A 1x1 transparent raster is the smallest thing that is
  // still a picture, and it keeps every caller's dimensions arithmetic total.
  if (count === 0) return createRaster(1, 1, [0, 0, 0, 0]);

  let tileWidth = 0;
  let tileHeight = 0;
  for (const render of renders) {
    if (render.raster.width > tileWidth) tileWidth = render.raster.width;
    if (render.raster.height > tileHeight) tileHeight = render.raster.height;
  }

  const requested = columns ?? Math.ceil(Math.sqrt(count));
  const across = clamp(Number.isFinite(requested) ? Math.floor(requested) : 1, 1, count);
  const down = Math.ceil(count / across);
  const width = SHEET_MARGIN * 2 + across * tileWidth + (across - 1) * TILE_GAP;
  const height = SHEET_MARGIN * 2 + down * tileHeight + (down - 1) * TILE_GAP;
  const sheet = createRaster(width, height, SHEET_BACKGROUND);

  // The rules run the full sheet, so the margin reads as part of the lattice
  // rather than as a border around it.
  for (let column = 1; column < across; column++) {
    const x = SHEET_MARGIN + column * tileWidth + (column - 1) * TILE_GAP;
    for (let y = 0; y < height; y++) setPixel(sheet, x, y, SHEET_SEPARATOR);
  }
  for (let row = 1; row < down; row++) {
    const y = SHEET_MARGIN + row * tileHeight + (row - 1) * TILE_GAP;
    for (let x = 0; x < width; x++) setPixel(sheet, x, y, SHEET_SEPARATOR);
  }

  for (let i = 0; i < count; i++) {
    const render = renders[i];
    if (!render) continue;
    const column = i % across;
    const row = Math.floor(i / across);
    const originX = SHEET_MARGIN + column * (tileWidth + TILE_GAP);
    const originY = SHEET_MARGIN + row * (tileHeight + TILE_GAP);
    const { raster } = render;
    const rowLength = raster.width * 4;
    for (let y = 0; y < raster.height; y++) {
      const from = y * rowLength;
      const to = ((originY + y) * width + originX) * 4;
      sheet.rgba.set(raster.rgba.subarray(from, from + rowLength), to);
    }
  }

  return sheet;
}

/* ------------------------------------------------------------------ */
/* The standard views                                                  */
/* ------------------------------------------------------------------ */

/**
 * Four orthographic views of the same subject, `d` units out.
 *
 * `d` is 10 rather than 1 so that a metre-scale scene — everything from a mug
 * to a room — sits entirely in front of the eye plane, where an offset of one
 * unit would put the camera inside most subjects and cut them. Since the views
 * are orthographic and auto-framed, the distance has no other effect on the
 * picture.
 *
 * `top` carries the two things a straight-down view needs. Its offset has a
 * sliver of z in it, so the view direction is never exactly parallel to the
 * world up that the fallback would otherwise reach for, and its up is stated
 * explicitly as -z: looking down with -z up the screen keeps +x to the right,
 * which is the same handedness as the front view, so the four tiles read as one
 * subject turned rather than four unrelated pictures.
 */
const STANDARD_DISTANCE = 10;

export const STANDARD_VIEWS: ViewSpec[] = [
  { name: 'front', offset: [0, 0, STANDARD_DISTANCE], up: [0, 1, 0] },
  { name: 'right', offset: [STANDARD_DISTANCE, 0, 0], up: [0, 1, 0] },
  { name: 'top', offset: [0, STANDARD_DISTANCE, 0.0001], up: [0, 0, -1] },
  { name: 'iso', offset: [STANDARD_DISTANCE, -STANDARD_DISTANCE, STANDARD_DISTANCE], up: [0, 1, 0] },
];
