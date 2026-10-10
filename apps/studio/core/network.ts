import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export function publicAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)));
  }
  // Only globally routable IPv6; reject mapped IPv4, local and reserved addresses.
  return /^[23][0-9a-f]{3}:/i.test(ip) && !ip.toLowerCase().startsWith('2001:db8:');
}
export async function safeFetch(raw: string, maxBytes = 2_000_000, signal?:AbortSignal): Promise<{ bytes: Uint8Array; type: string; url: string }> {
  let url = new URL(raw);
  for (let redirects = 0; redirects < 4; redirects++) {
    signal?.throwIfAborted();
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('Research links must use public HTTPS');
    const addresses = await lookup(url.hostname, { all: true });
    if (!addresses.length || addresses.some(x => !publicAddress(x.address))) throw new Error('Private network addresses are blocked');
    // Pin resolution for the request; validation alone would permit a DNS rebinding race.
    const { request } = await import('node:https');
    const res = await new Promise<{ bytes: Uint8Array; type: string; location?: string; status: number }>((resolve, reject) => {
      const req = request(url, { signal, servername:url.hostname, headers: { Host:url.host, 'User-Agent': 'AnascummisStudio/0.1 (local research)' }, lookup: ((_host: string, options: {all?:boolean}, cb: Function) => options.all?cb(null,[addresses[0]]):cb(null, addresses[0].address, addresses[0].family)) as any }, response => {
        const status = response.statusCode || 500;
        if (status >= 300 && status < 400 && response.headers.location) { response.resume(); resolve({ bytes: new Uint8Array(), type: '', location: response.headers.location, status }); return; }
        const chunks: Buffer[] = []; let size = 0;
        response.on('data', c => { size += c.length; if (size > maxBytes) { response.destroy(new Error('Research response too large')); } else chunks.push(c); });
        response.on('end', () => resolve({ bytes: Buffer.concat(chunks), type: (response.headers['content-type'] || '').split(';')[0], status }));
        response.on('error', reject);
      });
      req.on('error', reject); req.setTimeout(15_000, () => req.destroy(new Error('Research request timed out'))); req.end();
    });
    if (res.location) { url = new URL(res.location, url); continue; }
    if (res.status < 200 || res.status >= 300) throw new Error(`Research source returned ${res.status}`);
    return { ...res, url: url.href };
  }
  throw new Error('Too many redirects');
}
