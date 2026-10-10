import { scryptSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { join } from 'node:path';
import { DATA } from './storage';
import { rename } from 'node:fs/promises';

const path = join(DATA, 'vault.enc');
let key: Buffer | undefined, salt: Buffer | undefined;
let entries: Record<string, string> = {};
let timer: ReturnType<typeof setTimeout> | undefined;
function touch() { clearTimeout(timer); timer = setTimeout(lock, 15 * 60_000); timer.unref(); }
export function lock() { key?.fill(0); key = undefined; salt = undefined; entries = {}; clearTimeout(timer); }
export async function status() { return { exists: await Bun.file(path).exists(), unlocked: !!key }; }
export async function unlock(password: string) {
  if (password.length < 10) throw new Error('Use a vault passphrase with at least 10 characters');
  const exists = await Bun.file(path).exists();
  if (exists) {
    const envelope = await Bun.file(path).json();
    const s = Buffer.from(envelope.salt, 'base64');
    const k = scryptSync(password, s, 32);
    try {
      const decipher = createDecipheriv('aes-256-gcm', k, Buffer.from(envelope.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
      const text = Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString();
      entries = JSON.parse(text); key = k; salt = s;
    } catch { k.fill(0); throw new Error('Incorrect vault passphrase'); }
  } else { key = scryptSync(password, salt = randomBytes(16), 32); entries = {}; await persist(); }
  touch(); return all();
}
async function persist() {
  if (!key || !salt) throw new Error('Unlock the vault first');
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(entries)), cipher.final()]);
  await Bun.write(path + '.tmp', JSON.stringify({ salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }));
  await rename(path + '.tmp', path);
}
export function all() { if (!key) throw new Error('Vault is locked'); touch(); return { ...entries }; }
export async function save(name: string, value: string) {
  if (!key) throw new Error('Vault is locked');
  if (!/^[\w .-]{1,80}$/.test(name) || ['__proto__','constructor','prototype'].includes(name) || value.length > 10000) throw new Error('Invalid vault entry');
  entries[name] = value; await persist(); touch(); return all();
}
export async function remove(name: string) { if (!key) throw new Error('Vault is locked'); delete entries[name]; await persist(); return all(); }
export function lookup(name: string) {
  if (!key) throw new Error('Vault is locked');
  if (!Object.hasOwn(entries,name)) throw new Error('Saved detail not found');
  touch(); return entries[name];
}
