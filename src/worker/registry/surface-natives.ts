import type { CapabilityContract, JsonSchema, PermissionName, RiskClass, SurfaceEmphasis } from '@shared/types';
import { fail, ok, type Result } from '@shared/types';
import type { NativeContext, NativeHandler } from './registry';
import type { ActionOutcome, ActionRequest } from '../ink/runtime';
import type { SurfaceCollector, SurfaceIssue, SurfaceWindowDraft } from '../surfaces/surface';
import type { PersonaSlot } from '../personas/wear';
import { AUTHORED_PERSONAS, authoredPersona } from '../personas/authored';
import { validatePersona } from '../personas/harness';

/**
 * Presentational capabilities: the windows a turn puts on screen, and the
 * costume the shell wears while it does it.
 *
 * Four contracts rather than one "show something" call, for the same reason the
 * lab capabilities are three: each is a separate intention, and a surface that
 * failed to open should not take a costume down with it.
 *
 * All four are `risk: 'none'` with no permissions and no confirmation, and that
 * is not a shortcut — it is what makes them the only capabilities the Ink
 * runtime is allowed to resolve inline, without a dispatch. Nothing here
 * touches the network, the workspace, or a provider. A window is a decision
 * about the host's own screen, made from data the turn already has, and there
 * is no work in it for a permission check to protect.
 *
 * The two callers are shaped differently and this module serves both:
 *
 *   - The model calls these as tools, with named arguments, through the
 *     dispatcher: validated against the schemas below, recorded, audited.
 *   - An authored story calls them as Ink externals, positionally, and the
 *     runtime answers them inline (see `presentationInline`).
 */

const VERSION = '1.0.0';

function surfaceContract(input: {
  id: string;
  title: string;
  summary: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
}): CapabilityContract {
  const permissions: PermissionName[] = [];
  const risk: RiskClass = 'none';
  return {
    id: input.id,
    version: VERSION,
    sourceHash: `native:${input.id}@${VERSION}`,
    kind: 'native',
    title: input.title,
    summary: input.summary,
    owner: 'host',
    workspaceScope: 'session',
    input: input.inputSchema,
    output: input.outputSchema,
    permissions,
    risk,
    requiresConfirmation: false,
    budget: {
      timeoutMs: 5_000,
      instructionLimit: 0,
      outputBytes: 32 * 1024,
      hostCalls: 1,
    },
    idempotent: true,
    cancellable: true,
    validation: {
      validatedAt: '2026-09-10T00:00:00.000Z',
      validator: 'host-seed@1',
      checks: [
        { name: 'host-authored', passed: true },
        { name: 'no-permissions', passed: true },
        { name: 'no-side-effects', passed: true },
      ],
      passed: true,
    },
    status: 'installed',
    installedAt: '2026-09-10T00:00:00.000Z',
  };
}

const stringSchema = (description: string, maxLength = 400): JsonSchema => ({
  type: 'string',
  description,
  maxLength,
});

/* ------------------------------------------------------------------ */
/* The shape of a window, as the model sees it                         */
/* ------------------------------------------------------------------ */

/*
 * These schemas are the tool description. The model has no other account of
 * what a window is, so the descriptions carry the rules that matter — an id is
 * reused to update, a picture needs a description of itself — rather than
 * leaving them to be discovered by refusal.
 */

const blockSchema: JsonSchema = {
  type: 'object',
  properties: {
    id: stringSchema('Unique within the tab. Reused on a later turn, it updates this block.', 64),
    kind: {
      type: 'string',
      enum: ['text', 'image', 'code', 'list', 'fields', 'links'],
      description: 'What the block is. Each kind renders as itself; there is no free markup.',
    },
    title: stringSchema('Shown above the block.', 120),
    text: stringSchema('Prose, for text and code. Blank lines separate paragraphs.', 4000),
    url: stringSchema('For image: an absolute https URL, or workspace:<name> for a session artifact.', 2000),
    alt: stringSchema('For image. Required, and never empty: a picture nobody can see needs a description.', 400),
    language: stringSchema('For code. A hint for the renderer only.', 40),
    caption: stringSchema('Shown beneath the block, quieter than its content.', 300),
    items: {
      type: 'array',
      description: 'For list.',
      items: { type: 'string', maxLength: 400 },
    },
    fields: {
      type: 'array',
      description: 'For fields, in the order given.',
      items: {
        type: 'object',
        properties: { label: stringSchema('', 80), value: stringSchema('', 400) },
        required: ['label', 'value'],
        additionalProperties: false,
      },
    },
    links: {
      type: 'array',
      description: 'For links.',
      items: {
        type: 'object',
        properties: { label: stringSchema('', 120), href: stringSchema('Absolute http(s) URL.', 2000) },
        required: ['label', 'href'],
        additionalProperties: false,
      },
    },
  },
  required: ['id', 'kind'],
  additionalProperties: false,
};

const tabSchema: JsonSchema = {
  type: 'object',
  properties: {
    id: stringSchema('Unique within the window, and stable across turns.', 64),
    title: stringSchema('The tab label.', 60),
    badge: stringSchema('A short marker on the right, e.g. a count.', 24),
    blocks: { type: 'array', description: 'What the tab holds.', items: blockSchema },
  },
  required: ['id', 'title', 'blocks'],
  additionalProperties: false,
};

const windowInputSchema: JsonSchema = {
  type: 'object',
  properties: {
    id: stringSchema(
      'Stable across turns. Reusing an id updates the window already on screen instead of opening a second one.',
      64,
    ),
    title: stringSchema('What the window is called.', 120),
    subtitle: stringSchema('A quieter second line under the title.', 200),
    emphasis: {
      type: 'string',
      enum: ['quiet', 'normal', 'attention'],
      description:
        'How loudly it asks. attention is for a window that should be looked at now, and the host lowers it as the screen fills; quiet is a window that is simply available.',
    },
    activeTabId: stringSchema('The tab to bring forward.', 64),
    raisedBy: stringSchema('What this window is for, in your own words.', 200),
    size: {
      type: 'object',
      properties: {
        width: { type: 'integer', minimum: 240, maximum: 2400 },
        height: { type: 'integer', minimum: 240, maximum: 2400 },
      },
      required: ['width', 'height'],
      additionalProperties: false,
    },
    tabs: { type: 'array', description: 'At least one tab; a window with nothing in it is refused.', items: tabSchema },
  },
  required: ['id', 'title', 'tabs'],
  additionalProperties: false,
};

const windowOutputSchema: JsonSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    updated: { type: 'boolean', description: 'True when this replaced a window that was already open.' },
    emphasis: { type: 'string', enum: ['quiet', 'normal', 'attention'] },
    tabs: { type: 'integer' },
    open: { type: 'integer', description: 'Windows believed open once this is applied.' },
  },
};

/* ------------------------------------------------------------------ */
/* surface.window                                                      */
/* ------------------------------------------------------------------ */

const windowHandler: NativeHandler = {
  contract: surfaceContract({
    id: 'surface.window',
    title: 'Open or update a window',
    summary:
      'Puts a window on screen, or replaces the one already carrying that id. Use it for anything worth looking at rather than reading: a comparison, a table, a picture, a set of links.',
    inputSchema: windowInputSchema,
    outputSchema: windowOutputSchema,
  }),
  async execute(ctx: NativeContext): Promise<Result<unknown>> {
    const collector = ctx.surfaces;
    if (!collector) {
      return fail(
        'missing-capability',
        'There is no turn to put a surface on. Windows belong to a turn; nothing is shown outside one.',
      );
    }
    // The schema has already decided the shape, so the cast records that the
    // validator did the work rather than skipping it.
    const accepted = collector.open(ctx.args as unknown as SurfaceWindowDraft);
    if (!accepted.ok) return fail('invalid-argument', describeIssues(accepted.issues));
    return ok({
      id: accepted.window.id,
      updated: accepted.updated,
      emphasis: accepted.window.emphasis,
      tabs: accepted.window.tabs.length,
      open: collector.openCount(),
    });
  },
};

/* ------------------------------------------------------------------ */
/* surface.close                                                       */
/* ------------------------------------------------------------------ */

const closeHandler: NativeHandler = {
  contract: surfaceContract({
    id: 'surface.close',
    title: 'Close a window',
    summary:
      'Takes a window down by id. Closing something that is not open is not an error; the client may hold windows this turn knows nothing about.',
    inputSchema: {
      type: 'object',
      properties: {
        id: stringSchema('The window to close.', 64),
        reason: stringSchema('Why it is going, when that is worth saying.', 200),
      },
      required: ['id'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, closed: { type: 'boolean' }, open: { type: 'integer' } },
    },
  }),
  async execute(ctx: NativeContext): Promise<Result<unknown>> {
    const collector = ctx.surfaces;
    if (!collector) {
      return fail('missing-capability', 'There is no turn to close a surface on.');
    }
    const reason = typeof ctx.args.reason === 'string' ? ctx.args.reason : undefined;
    const accepted = collector.close(String(ctx.args.id ?? ''), reason);
    if (!accepted.ok) return fail('invalid-argument', describeIssues(accepted.issues));
    return ok({ id: accepted.close.id, closed: true, open: collector.openCount() });
  },
};

/* ------------------------------------------------------------------ */
/* persona.wear and persona.clear                                      */
/* ------------------------------------------------------------------ */

const wearHandler: NativeHandler = {
  contract: surfaceContract({
    id: 'persona.wear',
    title: 'Wear a costume',
    summary:
      'Puts one of the authored costumes on the shell for a moment. Costumes are fixed and few; this chooses one, it does not design one. Say why in the reason.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          enum: AUTHORED_PERSONAS.map((persona) => persona.id),
          description: `Which costume. One of: ${authoredList()}.`,
        },
        bitId: stringSchema('The bit to play, when one fits better than the whole costume.', 64),
        reason: stringSchema('Why it went on, in your own words. The interface shows this.', 240),
      },
      required: ['id', 'reason'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        personaId: { type: 'string' },
        name: { type: 'string' },
        bitId: { type: 'string' },
        expiresAt: { type: 'string' },
        seconds: { type: 'integer' },
      },
    },
  }),
  async execute(ctx: NativeContext): Promise<Result<unknown>> {
    const slot = ctx.persona;
    if (!slot) {
      return fail('missing-capability', 'There is no turn to wear a costume in.');
    }
    const id = String(ctx.args.id ?? '');
    const persona = authoredPersona(id);
    if (!persona) {
      return fail(
        'invalid-argument',
        `There is no authored costume called "${id}". The costumes are: ${AUTHORED_PERSONAS.map((p) => p.id).join(', ')}.`,
      );
    }

    // A costume is checked before it is worn even though the same check runs
    // over the whole authored set in the tests. The authored file is source
    // that someone will edit, and the wear path is where a bad edit would
    // otherwise reach a screen.
    const verdict = validatePersona(persona);
    if (!verdict.ok) {
      return fail('invalid-argument', `That costume does not pass its own checks: ${describeIssues(verdict.findings)}`);
    }

    const bitId = typeof ctx.args.bitId === 'string' && ctx.args.bitId !== '' ? ctx.args.bitId : null;
    if (bitId !== null && !persona.bits.some((bit) => bit.id === bitId)) {
      return fail(
        'invalid-argument',
        `${persona.name} has no bit called "${bitId}". Its bits are: ${persona.bits.map((b) => b.id).join(', ')}.`,
      );
    }

    const wear = slot.wear(persona, {
      reason: String(ctx.args.reason),
      bitId,
      now: new Date(),
    });
    return ok({
      personaId: wear.persona.id,
      name: wear.persona.name,
      ...(wear.bitId ? { bitId: wear.bitId } : {}),
      expiresAt: wear.expiresAt,
      seconds: Math.round(persona.maxDurationMs / 1000),
    });
  },
};

const clearHandler: NativeHandler = {
  contract: surfaceContract({
    id: 'persona.clear',
    title: 'Take the costume off',
    summary: 'Returns the shell to its own face. Nothing to do when nothing is worn, which is not an error.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: { type: 'object', properties: { cleared: { type: 'boolean' } } },
  }),
  async execute(ctx: NativeContext): Promise<Result<unknown>> {
    const slot = ctx.persona;
    if (!slot) {
      return fail('missing-capability', 'There is no turn to take a costume off in.');
    }
    slot.clear();
    return ok({ cleared: true });
  },
};

export const SURFACE_NATIVES: NativeHandler[] = [windowHandler, closeHandler, wearHandler, clearHandler];

/* ------------------------------------------------------------------ */
/* The story path                                                      */
/* ------------------------------------------------------------------ */

/** The presentation channels one turn has to offer. Both are optional, together. */
export interface PresentationChannels {
  surfaces?: SurfaceCollector;
  persona?: PersonaSlot;
}

/**
 * The same four capabilities, answered from a story rather than dispatched.
 *
 * Ink externals take positional arguments and cannot await, so an authored
 * story calls `surface_window(id, title, body)` and gets an answer inside the
 * same pass. What a story can read back is a string — it has no way to walk a
 * structure — so the answer is the bare id on success and `error: ...` on
 * refusal, which a story can test for with `?` or simply print.
 *
 * Returning null is the important case: it means "not one of mine", and the
 * runtime yields to the dispatcher as it would for any other external. Every
 * capability with a permission, a cost, or a consequence must take that route.
 */
export function presentationInline(
  channels: PresentationChannels,
): (request: ActionRequest) => ActionOutcome | null {
  return (request: ActionRequest): ActionOutcome | null => {
    if (!isPresentational(request.capabilityId)) return null;
    try {
      return answerInline(request, channels);
    } catch (err) {
      // An inline resolver runs inside the story's Continue(), where nothing
      // can catch a throw on the story's behalf: one would surface as the whole
      // pass failing, for a window that did not open.
      return { kind: 'failure', message: `That could not be shown: ${describe(err)}` };
    }
  };
}

function isPresentational(capabilityId: string): boolean {
  return (
    capabilityId === 'surface.window' ||
    capabilityId === 'surface.close' ||
    capabilityId === 'persona.wear' ||
    capabilityId === 'persona.clear'
  );
}

function answerInline(request: ActionRequest, channels: PresentationChannels): ActionOutcome | null {
  switch (request.capabilityId) {
    case 'surface.window': {
      const collector = channels.surfaces;
      if (!collector) return { kind: 'failure', message: 'There is no turn to put a window on.' };
      const [id, title, body, emphasis] = request.args.map((arg) => (typeof arg === 'string' ? arg : ''));
      if (!id || !title) {
        return { kind: 'failure', message: 'A window needs an id and a title: surface_window(id, title, body).' };
      }
      const draft: SurfaceWindowDraft = {
        id,
        title,
        ...(isEmphasis(emphasis) ? { emphasis } : {}),
        tabs: [
          {
            id: 'main',
            title,
            blocks: [{ id: 'body', kind: 'text', text: body ?? '' }],
          },
        ],
      };
      const accepted = collector.open(draft);
      if (!accepted.ok) return { kind: 'failure', message: describeIssues(accepted.issues) };
      // The id, because a story that raised two windows may want to close one.
      return { kind: 'value', value: accepted.window.id };
    }

    case 'surface.close': {
      const collector = channels.surfaces;
      if (!collector) return { kind: 'failure', message: 'There is no turn to close a window on.' };
      const [id, reason] = request.args.map((arg) => (typeof arg === 'string' ? arg : ''));
      if (!id) return { kind: 'failure', message: 'Closing a window needs its id: surface_close(id).' };
      const accepted = collector.close(id, reason || undefined);
      if (!accepted.ok) return { kind: 'failure', message: describeIssues(accepted.issues) };
      return { kind: 'value', value: id };
    }

    case 'persona.wear': {
      const slot = channels.persona;
      if (!slot) return { kind: 'failure', message: 'There is no turn to wear a costume in.' };
      const [id, reason, bitId] = request.args.map((arg) => (typeof arg === 'string' ? arg : ''));
      const persona = authoredPersona(id ?? '');
      if (!persona) {
        return {
          kind: 'failure',
          message: `There is no authored costume called "${id ?? ''}". The costumes are: ${AUTHORED_PERSONAS.map((p) => p.id).join(', ')}.`,
        };
      }
      const verdict = validatePersona(persona);
      if (!verdict.ok) {
        return { kind: 'failure', message: describeIssues(verdict.findings) };
      }
      const bit = bitId && persona.bits.some((candidate) => candidate.id === bitId) ? bitId : null;
      // The occasion is a true statement about when this costume belongs, so it
      // stands in as the reason when the story does not give one. The interface
      // shows a reason either way; an empty one would read as a bug.
      const wear = slot.wear(persona, { reason: reason || persona.occasion, bitId: bit, now: new Date() });
      return { kind: 'value', value: `${wear.persona.id}/${wear.bitId ?? 'idle'}` };
    }

    case 'persona.clear': {
      const slot = channels.persona;
      if (!slot) return { kind: 'failure', message: 'There is no turn to take a costume off in.' };
      slot.clear();
      return { kind: 'value', value: 'cleared' };
    }

    default:
      return null;
  }
}

function isEmphasis(value: string | undefined): value is SurfaceEmphasis {
  return value === 'quiet' || value === 'normal' || value === 'attention';
}

/* ------------------------------------------------------------------ */
/* Refusals                                                            */
/* ------------------------------------------------------------------ */

/**
 * A refusal a caller can act on.
 *
 * Findings are cut off after a few: past that nobody is reading a diagnosis,
 * and the count says the rest is there. The order is the order the checks ran,
 * so the first line is the one worth fixing first. Windows and costumes report
 * the same way because a caller does not care which of the two refused it.
 */
function describeIssues(issues: { message: string }[]): string {
  const shown = issues.slice(0, 5).map((finding) => finding.message);
  const rest = issues.length - shown.length;
  const tail = rest > 0 ? ` (and ${rest} more)` : '';
  return `${issues.length} finding${issues.length === 1 ? '' : 's'}: ${shown.join(' ')}${tail}`;
}

function authoredList(): string {
  return AUTHORED_PERSONAS.map((persona) => `${persona.id} (${persona.occasion})`).join('; ');
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
