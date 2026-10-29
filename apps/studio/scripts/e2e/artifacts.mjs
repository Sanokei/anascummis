import {inflateRawSync} from 'node:zlib';
import {readFile, writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

/** Read the actual download/trace ZIP independently of the application's writer. */
export function zipEntries(input) {
  const bytes = Buffer.from(input), result = new Map();
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65_557) && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  assert(end >= 0 && bytes.readUInt32LE(end) === 0x06054b50, 'Download must contain a ZIP directory.');
  const count = bytes.readUInt16LE(end + 10); assert(count < 10_000, 'ZIP exceeds evidence file budget.');
  let at = bytes.readUInt32LE(end + 16), total = 0;
  for (let index = 0; index < count; index++) {
    assert.equal(bytes.readUInt32LE(at), 0x02014b50, 'Invalid ZIP directory entry.');
    const method = bytes.readUInt16LE(at + 10), compressed = bytes.readUInt32LE(at + 20), size = bytes.readUInt32LE(at + 24);
    const nameLength = bytes.readUInt16LE(at + 28), extra = bytes.readUInt16LE(at + 30), comment = bytes.readUInt16LE(at + 32), local = bytes.readUInt32LE(at + 42);
    const name = bytes.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    assert(!name.startsWith('/') && !name.split('/').includes('..') && !name.includes('\\'), 'Unsafe ZIP path.');
    assert.equal(bytes.readUInt32LE(local), 0x04034b50, 'Invalid ZIP local entry.');
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    assert(start + compressed <= bytes.length, 'Truncated ZIP payload.');
    const data = bytes.subarray(start, start + compressed);
    total += size; assert(total <= 200_000_000, 'ZIP exceeds evidence byte budget.');
    assert(method === 0 || method === 8, 'Unsupported ZIP compression.');
    const decoded = method === 8 ? inflateRawSync(data, {maxOutputLength: size + 1}) : data;
    assert.equal(decoded.length, size, 'Truncated expanded ZIP payload.');
    assert(!result.has(name), 'Duplicate ZIP name.'); result.set(name, decoded);
    at += 46 + nameLength + extra + comment;
  }
  return result;
}

function storedZip(entries) {
  const local = [], central = []; let offset = 0;
  for (const [name, data] of entries) {
    const filename = Buffer.from(name), body = Buffer.from(data); let crc = 0xffffffff;
    for (const byte of body) {crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;}
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30 + filename.length); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(body.length, 18); header.writeUInt32LE(body.length, 22); header.writeUInt16LE(filename.length, 26); filename.copy(header, 30);
    local.push(header, body);
    const directory = Buffer.alloc(46 + filename.length); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x800, 8);
    directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(body.length, 20); directory.writeUInt32LE(body.length, 24); directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(offset, 42); filename.copy(directory, 46);
    central.push(directory); offset += header.length + body.length;
  }
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(central.reduce((sum, entry) => sum + entry.length, 0), 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

/** Traces are useful for replay, but their ephemeral local session cookie is not. */
export async function redactTrace(path) {
  const entries = zipEntries(await readFile(path));
  function clean(value, key = '') {
    if (Array.isArray(value)) {
      if (key === 'cookies') return [];
      if (key === 'headers') return value.filter(header => !/^(?:cookie|set-cookie|authorization|proxy-authorization|x-api-key)$/i.test(header.name || '')).map(item => clean(item));
      return value.map(item => clean(item));
    }
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, clean(item, name)]));
    if (typeof value === 'string') return value.replace(/studio=[a-f0-9-]{36}/g, 'studio=[redacted]');
    return value;
  }
  for (const [name, body] of entries) {
    if (/\.(?:trace|network)$/.test(name)) {
      const lines = body.toString('utf8').split('\n').filter(Boolean).map(line => JSON.stringify(clean(JSON.parse(line))));
      entries.set(name, Buffer.from(lines.join('\n') + '\n'));
    } else if (/\.json$/.test(name)) {
      // Network resources can be pretty-printed response JSON, not trace JSONL.
      const text = body.toString('utf8');
      try {entries.set(name, Buffer.from(JSON.stringify(clean(JSON.parse(text)))));}
      catch {entries.set(name, Buffer.from(text.replace(/studio=[a-f0-9-]{36}/g, 'studio=[redacted]')));}
    }
  }
  await writeFile(path, storedZip(entries));
}

export function samplePdf() {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const stream = 'BT /F1 18 Tf 72 720 Td (Bakery packing list: 3 loaves, 2 croissants.) Tj ET\n';
  objects.push('<< /Length ' + Buffer.byteLength(stream) + ' >>\nstream\n' + stream + 'endstream');
  let output = '%PDF-1.4\n'; const offsets = [0];
  for (let index = 0; index < objects.length; index++) {offsets.push(Buffer.byteLength(output)); output += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;}
  const start = Buffer.byteLength(output); output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('');
  return Buffer.from(output + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);
}
