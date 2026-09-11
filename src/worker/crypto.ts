/** Web Crypto helpers. Nothing here ever accepts a value bound for a prompt. */

const enc = new TextEncoder();
const dec = new TextDecoder();

export function randomId(prefix = ''): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return prefix ? `${prefix}_${hex}` : hex;
}

/**
 * The shape of an id `randomId` produces, for the layers that have to decide
 * whether a string could be one.
 *
 * It lives beside the generator rather than at each site that checks it,
 * because an id grammar restated per call site drifts from the thing minting
 * the ids, and the drift is silent in the worse direction: a *valid* id starts
 * being refused by whichever copy was not updated.
 *
 * Deliberately looser than what today's generator happens to emit. It answers
 * "could this have come from `randomId`", not "did this call produce it" —
 * pinning it to sixteen bytes of hex would turn any future change to the
 * generator into an instant refusal of every id already written down.
 */
export const GENERATED_ID = /^[a-z]+_[a-z0-9]{1,60}$/;

export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function sha256Hex(input: string | ArrayBuffer): Promise<string> {
  const data = typeof input === 'string' ? enc.encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Stable stringify so an arguments hash does not depend on key order. */
export function canonicalJson(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(v as Record<string, unknown>).sort()) {
        out[key] = walk((v as Record<string, unknown>)[key]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(walk(value));
}

async function hmacKey(secret: string, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usages);
}

export async function hmacSign(secret: string, message: string): Promise<string> {
  const key = await hmacKey(secret, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return base64url(new Uint8Array(sig));
}

export async function hmacVerify(secret: string, message: string, signature: string): Promise<boolean> {
  const key = await hmacKey(secret, ['verify']);
  try {
    return await crypto.subtle.verify('HMAC', key, fromBase64url(signature), enc.encode(message));
  } catch {
    return false;
  }
}

/** Constant-time string compare for tokens that were not HMAC-verified. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function aesKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest('SHA-256', enc.encode(`aes:${secret}`));
  return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** Third-party tokens are encrypted at rest and only ever decrypted host-side. */
export async function encryptToRest(secret: string, plaintext: string): Promise<{ ciphertext: string; iv: string }> {
  const key = await aesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const buf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  return { ciphertext: base64url(new Uint8Array(buf)), iv: base64url(iv) };
}

export async function decryptFromRest(secret: string, ciphertext: string, iv: string): Promise<string | null> {
  try {
    const key = await aesKey(secret);
    const buf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64url(iv) },
      key,
      fromBase64url(ciphertext),
    );
    return dec.decode(buf);
  } catch {
    return null;
  }
}

/** RFC 7636 S256 challenge. */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(verifier));
  return base64url(new Uint8Array(digest));
}
