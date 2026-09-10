/// <reference types="@cloudflare/workers-types" />

/**
 * Worker bindings. Secrets are declared here so the type checker catches any
 * attempt to hand one to the model, to Lua, or to a generated artifact.
 */
export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  CACHE: KVNamespace;
  SESSION: DurableObjectNamespace;
  AI?: Ai;
  /** Durable store for page and screenshot images used by vision retrieval. */
  VISION?: R2Bucket;

  // Plain vars.
  APP_NAME: string;
  DEEPSEEK_BASE_URL: string;
  DEEPSEEK_MODEL: string;
  DEEPSEEK_MODEL_PRO: string;
  DEEPSEEK_MODEL_VISION: string;
  WORKERS_AI_CHAT_MODEL: string;
  WORKERS_AI_TRANSCRIBE_MODEL: string;
  GUEST_RETENTION_SECONDS: string;
  MAX_STORY_DISPATCHES_PER_TURN: string;
  MAX_FORGE_ATTEMPTS: string;
  APP_URL?: string;

  // Cloudflare Access gate. When ACCESS_REQUIRED is anything but "false" the
  // Worker fails closed: no Access, nothing served.
  ACCESS_REQUIRED?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  /** Comma-separated domains permitted behind the Access policy. */
  ACCESS_ALLOWED_DOMAINS?: string;

  // Secrets. All optional: the product degrades to an honest unavailable state
  // rather than pretending a provider exists.
  DEEPSEEK_API_KEY?: string;
  OPENAI_API_KEY?: string;
  BRAVE_SEARCH_KEY?: string;
  SESSION_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  CLOUDFLARE_OAUTH_CLIENT_ID?: string;
  CLOUDFLARE_OAUTH_CLIENT_SECRET?: string;
  /** Comma-separated addresses granted the super-admin role on first sign-in. */
  SUPER_ADMIN_EMAILS?: string;
}

/** Names of every secret binding. Used to assert none of them leak outward. */
export const SECRET_BINDING_NAMES = [
  'DEEPSEEK_API_KEY',
  'OPENAI_API_KEY',
  'BRAVE_SEARCH_KEY',
  'SESSION_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'CLOUDFLARE_OAUTH_CLIENT_ID',
  'CLOUDFLARE_OAUTH_CLIENT_SECRET',
  'SUPER_ADMIN_EMAILS',
] as const;

export type SecretName = (typeof SECRET_BINDING_NAMES)[number];

export function intVar(env: Env, key: keyof Env, fallback: number): number {
  const raw = env[key];
  if (typeof raw !== 'string') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Strips every secret value out of an arbitrary object before it can reach a
 * prompt, a log line, a Lua argument, or a generated file.
 */
export function redactSecrets(env: Env, value: unknown): unknown {
  const secrets = SECRET_BINDING_NAMES.map((n) => env[n])
    .filter((v): v is string => typeof v === 'string' && v.length >= 8);
  if (secrets.length === 0) return value;
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') {
      let out = node;
      for (const s of secrets) out = out.split(s).join('[redacted]');
      return out;
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const copy: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) copy[k] = walk(v);
      return copy;
    }
    return node;
  };
  return walk(value);
}
