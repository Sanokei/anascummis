import type { CapabilityContract, JsonSchema, PermissionName, RiskClass } from '@shared/types';
import { fail, ok, type Result } from '@shared/types';
import type { NativeContext, NativeHandler } from './registry';
import { CapabilityRegistry } from './registry';
import type { Env } from '../env';
import { webSearch, toCitation } from '../providers/search';
import { retrievePage } from '../providers/retrieval';
import { randomId } from '../crypto';
import { VISION_NATIVES } from './vision-natives';

/**
 * Seed capabilities: trusted host adapters with registry contracts.
 *
 * These share the same permission checks, budget accounting, and audit records
 * as generated Lua. They are not a second unrestricted execution path, and
 * none of them is a generic shell, an unrestricted network call, or a way to
 * reach a raw provider credential.
 */

const VERSION = '1.0.0';

function contract(input: {
  id: string;
  title: string;
  summary: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  permissions: PermissionName[];
  risk: RiskClass;
  requiresConfirmation?: boolean;
  idempotent?: boolean;
  timeoutMs?: number;
  outputBytes?: number;
}): CapabilityContract {
  return {
    id: input.id,
    version: VERSION,
    // Native adapters are host source; the hash identifies the seed revision.
    sourceHash: `native:${input.id}@${VERSION}`,
    kind: 'native',
    title: input.title,
    summary: input.summary,
    owner: 'host',
    workspaceScope: 'global',
    input: input.inputSchema,
    output: input.outputSchema,
    permissions: input.permissions,
    risk: input.risk,
    requiresConfirmation: input.requiresConfirmation ?? false,
    budget: {
      timeoutMs: input.timeoutMs ?? 10_000,
      instructionLimit: 0,
      outputBytes: input.outputBytes ?? 256 * 1024,
      hostCalls: 1,
    },
    idempotent: input.idempotent ?? true,
    cancellable: true,
    validation: {
      validatedAt: '2026-09-10T00:00:00.000Z',
      validator: 'host-seed@1',
      checks: [
        { name: 'host-authored', passed: true },
        { name: 'contract-typechecked', passed: true },
      ],
      passed: true,
    },
    status: 'installed',
    installedAt: '2026-09-10T00:00:00.000Z',
  };
}

const stringSchema = (description: string, maxLength = 2000): JsonSchema => ({
  type: 'string',
  description,
  maxLength,
});

/* ------------------------------------------------------------------ */
/* web.search                                                          */
/* ------------------------------------------------------------------ */

const webSearchHandler: NativeHandler = {
  contract: contract({
    id: 'web.search',
    title: 'Search the web',
    summary: 'Returns ranked results with their source URLs. Never a composed answer.',
    inputSchema: {
      type: 'object',
      properties: {
        query: stringSchema('What to search for.', 400),
        limit: { type: 'integer', minimum: 1, maximum: 10, description: 'How many results.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: { title: { type: 'string' }, url: { type: 'string' }, snippet: { type: 'string' } },
          },
        },
        query: { type: 'string' },
      },
    },
    permissions: ['net.search'],
    risk: 'low',
  }),
  async execute(ctx: NativeContext): Promise<Result<unknown>> {
    const charged = ctx.chargeExternal();
    if (!charged.ok) return charged;
    const query = String(ctx.args.query ?? '');
    const limit = typeof ctx.args.limit === 'number' ? ctx.args.limit : 5;
    const res = await webSearch(ctx.env, { query, limit, signal: ctx.signal });
    if (!res.ok) return res;
    return ok({ query, results: res.value.map((h) => ({ ...toCitation(h) })) });
  },
};

/* ------------------------------------------------------------------ */
/* web.fetch                                                           */
/* ------------------------------------------------------------------ */

const webFetchHandler: NativeHandler = {
  contract: contract({
    id: 'web.fetch',
    title: 'Read a web page',
    summary: 'Retrieves one page as bounded text with its final URL. Untrusted task material.',
    inputSchema: {
      type: 'object',
      properties: {
        url: stringSchema('Absolute http or https URL.', 2000),
        maxChars: { type: 'integer', minimum: 500, maximum: 60000 },
      },
      required: ['url'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        finalUrl: { type: 'string' },
        title: { type: 'string' },
        text: { type: 'string' },
        truncated: { type: 'boolean' },
      },
    },
    permissions: ['net.fetch'],
    risk: 'low',
    outputBytes: 512 * 1024,
    timeoutMs: 15_000,
  }),
  async execute(ctx: NativeContext): Promise<Result<unknown>> {
    const charged = ctx.chargeExternal();
    if (!charged.ok) return charged;
    const res = await retrievePage({
      url: String(ctx.args.url ?? ''),
      maxChars: typeof ctx.args.maxChars === 'number' ? ctx.args.maxChars : undefined,
      signal: ctx.signal,
    });
    if (!res.ok) return res;
    const page = res.value;
    return ok({
      url: page.url,
      finalUrl: page.finalUrl,
      title: page.title,
      text: page.text,
      truncated: page.truncated,
    });
  },
};

/* ------------------------------------------------------------------ */
/* workspace.*                                                         */
/* ------------------------------------------------------------------ */

/**
 * Session-scoped artifact storage in KV. Guest data is expiry-bound; an
 * authenticated user's artifacts follow the same session boundary, because a
 * workspace is per session rather than per account.
 */

function workspaceKey(sessionId: string, name: string): string {
  return `ws:${sessionId}:${name}`;
}

const ARTIFACT_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}$/;

const workspaceWriteHandler: NativeHandler = {
  contract: contract({
    id: 'workspace.write',
    title: 'Save a workspace artifact',
    summary: 'Writes a named text artifact into this session workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        name: stringSchema('Artifact name.', 120),
        content: stringSchema('Artifact body.', 200_000),
        contentType: stringSchema('MIME type.', 100),
      },
      required: ['name', 'content'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, bytes: { type: 'integer' }, savedAt: { type: 'string' } },
    },
    permissions: ['workspace.write'],
    risk: 'low',
    idempotent: false,
  }),
  async execute(ctx: NativeContext): Promise<Result<unknown>> {
    const name = String(ctx.args.name ?? '');
    if (!ARTIFACT_NAME.test(name)) {
      return fail('invalid-argument', 'Artifact names may not contain path separators.');
    }
    const content = String(ctx.args.content ?? '');
    const ttl = Number.parseInt(ctx.env.GUEST_RETENTION_SECONDS, 10) || 86_400;
    await ctx.env.CACHE.put(
      workspaceKey(ctx.identity.sessionId, name),
      JSON.stringify({
        content,
        contentType: String(ctx.args.contentType ?? 'text/plain'),
        savedAt: new Date().toISOString(),
      }),
      { expirationTtl: Math.max(60, ttl) },
    );
    return ok({
      name,
      bytes: new TextEncoder().encode(content).length,
      savedAt: new Date().toISOString(),
    });
  },
};

const workspaceReadHandler: NativeHandler = {
  contract: contract({
    id: 'workspace.read',
    title: 'Read a workspace artifact',
    summary: 'Reads a named artifact from this session workspace.',
    inputSchema: {
      type: 'object',
      properties: { name: stringSchema('Artifact name.', 120) },
      required: ['name'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        content: { type: 'string' },
        contentType: { type: 'string' },
        savedAt: { type: 'string' },
      },
    },
    permissions: ['workspace.read'],
    risk: 'none',
  }),
  async execute(ctx: NativeContext): Promise<Result<unknown>> {
    const name = String(ctx.args.name ?? '');
    if (!ARTIFACT_NAME.test(name)) {
      return fail('invalid-argument', 'Artifact names may not contain path separators.');
    }
    const raw = await ctx.env.CACHE.get(workspaceKey(ctx.identity.sessionId, name));
    if (!raw) return fail('missing-capability', `No artifact named "${name}" exists in this workspace.`);
    const parsed = JSON.parse(raw) as { content: string; contentType: string; savedAt: string };
    return ok({ name, ...parsed });
  },
};

const workspaceListHandler: NativeHandler = {
  contract: contract({
    id: 'workspace.list',
    title: 'List workspace artifacts',
    summary: 'Lists artifact names in this session workspace.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: {
      type: 'object',
      properties: { names: { type: 'array', items: { type: 'string' } } },
    },
    permissions: ['workspace.read'],
    risk: 'none',
  }),
  async execute(ctx: NativeContext): Promise<Result<unknown>> {
    const prefix = `ws:${ctx.identity.sessionId}:`;
    const listed = await ctx.env.CACHE.list({ prefix, limit: 200 });
    return ok({ names: listed.keys.map((k) => k.name.slice(prefix.length)) });
  },
};

/* ------------------------------------------------------------------ */
/* memory.*                                                            */
/* ------------------------------------------------------------------ */

const memoryReadHandler: NativeHandler = {
  contract: contract({
    id: 'memory.recall',
    title: 'Recall a stored memory',
    summary: 'Reads durable memory. Requires an authenticated identity with persistence enabled.',
    inputSchema: {
      type: 'object',
      properties: { query: stringSchema('What to recall.', 400) },
      required: ['query'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        memories: {
          type: 'array',
          items: {
            type: 'object',
            properties: { path: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' } },
          },
        },
      },
    },
    permissions: ['memory.read'],
    risk: 'none',
  }),
  async execute(ctx: NativeContext): Promise<Result<unknown>> {
    if (ctx.identity.kind !== 'user') {
      return fail('not-authorised', 'Durable memory needs a signed-in account. Guests have none.');
    }
    const query = String(ctx.args.query ?? '').toLowerCase();
    const rows = await ctx.env.DB.prepare(
      `SELECT path, title, body FROM memory_files
       WHERE user_id = ? AND superseded_by IS NULL
       ORDER BY updated_at DESC LIMIT 40`,
    )
      .bind(ctx.identity.userId)
      .all<{ path: string; title: string; body: string }>();
    const terms = query.split(/\s+/).filter((t) => t.length > 2);
    const scored = (rows.results ?? [])
      .map((row) => {
        const hay = `${row.path} ${row.title} ${row.body}`.toLowerCase();
        return { row, score: terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0) };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    return ok({ memories: scored.map((s) => s.row) });
  },
};

/* ------------------------------------------------------------------ */
/* time.now                                                            */
/* ------------------------------------------------------------------ */

const clockHandler: NativeHandler = {
  contract: contract({
    id: 'time.now',
    title: 'Read the current time',
    summary: 'Returns the current UTC timestamp.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: {
      type: 'object',
      properties: { iso: { type: 'string' }, epochMs: { type: 'integer' } },
    },
    permissions: ['clock.read'],
    risk: 'none',
  }),
  async execute(): Promise<Result<unknown>> {
    const now = new Date();
    return ok({ iso: now.toISOString(), epochMs: now.getTime() });
  },
};

/* ------------------------------------------------------------------ */
/* cloudflare.preview.request                                          */
/* ------------------------------------------------------------------ */

/**
 * Temporary preview provisioning. The adapter and contract exist; the path
 * reports the exact missing prerequisite rather than fabricating a preview or
 * creating accounts repeatedly to evade a limit.
 */
const previewHandler: NativeHandler = {
  contract: contract({
    id: 'cloudflare.preview',
    title: 'Request a temporary preview workspace',
    summary: 'Asks Cloudflare for a temporary preview account for a guest deployment.',
    inputSchema: {
      type: 'object',
      properties: {
        policyAccepted: { type: 'boolean', description: 'Provider policy acceptance.' },
        label: stringSchema('What the preview is for.', 200),
      },
      required: ['policyAccepted'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        previewUrl: { type: 'string' },
        expiresAt: { type: 'string' },
        resources: { type: 'array', items: { type: 'string' } },
      },
    },
    permissions: ['cloudflare.deploy'],
    risk: 'moderate',
    requiresConfirmation: true,
    idempotent: false,
  }),
  async execute(ctx: NativeContext): Promise<Result<unknown>> {
    if (ctx.args.policyAccepted !== true) {
      return fail('not-authorised', 'Cloudflare requires explicit acceptance of its provider policy first.');
    }
    return fail(
      'missing-credential',
      'Temporary preview provisioning is not configured for this deployment. It needs a Cloudflare API token carrying the temporary-accounts scope, which this instance does not hold. Local and session work is preserved.',
    );
  },
};

/* ------------------------------------------------------------------ */
/* Registration                                                        */
/* ------------------------------------------------------------------ */

export function buildRegistry(env: Env): CapabilityRegistry {
  const registry = new CapabilityRegistry(env);
  for (const handler of [
    webSearchHandler,
    webFetchHandler,
    workspaceWriteHandler,
    workspaceReadHandler,
    workspaceListHandler,
    memoryReadHandler,
    clockHandler,
    previewHandler,
    // Vision is registered the same way as everything else: a contract in the
    // registry, reachable from Ink through the ordinary EXTERNAL name mapping.
    ...VISION_NATIVES,
  ]) {
    registry.registerNative(handler);
  }
  return registry;
}

/** Idempotency identity for a dispatch that has no natural key. */
export function newIdempotencyKey(): string {
  return randomId('idem');
}
