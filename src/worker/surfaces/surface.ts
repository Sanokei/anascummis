import type {
  PersonaWear,
  SurfaceBlock,
  SurfaceBlockKind,
  SurfaceClose,
  SurfaceEmphasis,
  SurfacePlan,
  SurfaceTab,
  SurfaceWindow,
  TurnSurfaces,
} from '@shared/types';
import {
  MAX_OPEN_SURFACES,
  MAX_SURFACE_BLOCKS_PER_TAB,
  MAX_SURFACE_TABS_PER_WINDOW,
  MAX_SURFACE_WINDOWS_PER_TURN,
} from '@shared/types';

/**
 * What one turn wants on screen, accumulated and checked before it is sent.
 *
 * A surface is the second half of a reply: text answers, a surface shows. That
 * makes everything here a *host* decision rather than a model one — the model
 * says what it wants shown, and this file decides whether the request is
 * answerable at all, how loudly it may ask, and what it looks like on the wire.
 *
 * Two rules shape the whole file:
 *
 *   1. **Count is not negotiable.** Six genuinely different things are six
 *      windows. What scales instead is manner: as more is open, each surface is
 *      spent more carefully (see `restraintFor`). Nothing is ever dropped to
 *      keep the screen tidy, because dropping it would be the host withholding
 *      work the person actually asked for.
 *
 *   2. **A refusal says what was wrong with it.** Every rejection carries typed
 *      findings with the numbers behind them, in the shape the design harness
 *      uses for a defective drawing. A model that gets a sentence back can fix
 *      its call; a model that gets a silently truncated window cannot tell that
 *      anything happened.
 *
 * Nothing here is asynchronous, imports the registry, or touches a provider.
 * That is deliberate: the Ink runtime consults a surface call *inline*, in the
 * middle of a synchronous story pass, and a collector that could await would
 * not be usable there.
 */

/* ------------------------------------------------------------------ */
/* Ceilings on one window                                              */
/* ------------------------------------------------------------------ */

/*
 * Every one of these refuses. None of them truncates.
 *
 * Truncation is the tempting option and it is the wrong one: a paragraph cut at
 * four thousand characters ends mid-sentence with nothing on screen to say so,
 * and the person reading it has no way to know that the rest existed. A refusal
 * can be reported, retried, or said out loud.
 *
 * The bounds themselves are about the shape of a window rather than about disk
 * or memory. A title is a label, so it is one line long; a block's prose is a
 * few paragraphs, because a window is something to consult while talking, not a
 * document to read in place of the conversation.
 */

export const MAX_WINDOW_TITLE_CHARS = 120;
export const MAX_WINDOW_SUBTITLE_CHARS = 200;
export const MAX_TAB_TITLE_CHARS = 60;
export const MAX_BADGE_CHARS = 24;
export const MAX_BLOCK_TITLE_CHARS = 120;
export const MAX_BLOCK_TEXT_CHARS = 4000;
export const MAX_CAPTION_CHARS = 300;
export const MAX_RAISED_BY_CHARS = 200;
export const MAX_LIST_ITEMS = 40;
export const MAX_LIST_ITEM_CHARS = 400;
export const MAX_FIELDS = 24;
export const MAX_FIELD_LABEL_CHARS = 80;
export const MAX_FIELD_VALUE_CHARS = 400;
export const MAX_LINKS = 24;
export const MAX_LINK_LABEL_CHARS = 120;
export const MAX_ID_CHARS = 64;
/** Reference size in CSS pixels. The client clamps anything outside this. */
export const MIN_WINDOW_SIDE = 240;
export const MAX_WINDOW_SIDE = 2400;

/**
 * The only block kinds that exist.
 *
 * Written as a `Record` keyed by the union rather than as an array of strings:
 * adding a kind to `SurfaceBlockKind` breaks this line at build time, where an
 * array would have quietly become a kind the renderer never agreed to draw.
 */
const BLOCK_KINDS: Record<SurfaceBlockKind, true> = {
  text: true,
  image: true,
  code: true,
  list: true,
  fields: true,
  links: true,
};

const EMPHASIS_VALUES: Record<SurfaceEmphasis, true> = {
  quiet: true,
  normal: true,
  attention: true,
};

/**
 * Ids are addresses, so they are matched exactly.
 *
 * Lower case only, because a model that writes `Budget` after writing `budget`
 * should update the window it already raised rather than raise a second one
 * beside it — and a case-sensitive match is the version of that which cannot be
 * guessed at later.
 */
const WELL_FORMED_ID = /^[a-z0-9][a-z0-9-]*$/;

/**
 * An image either comes from the web or from this session's workspace.
 *
 * `http:` is refused rather than upgraded: a picture fetched in the clear is a
 * different claim from the one the assistant made. `data:` is refused because a
 * data URI is content, not a reference to it, and the client is the only thing
 * that gets to decide what bytes it will decode.
 */
const WORKSPACE_REF = /^workspace:[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}$/;

/* ------------------------------------------------------------------ */
/* Findings                                                            */
/* ------------------------------------------------------------------ */

/**
 * A problem that makes a surface unusable, as opposed to merely plain.
 *
 * Mirrors `SvgIssue`: a stable code a caller can branch on, a sentence for a
 * person, and a pointer to the thing that is wrong. It goes further in one
 * respect only — a surface has three levels that can be at fault, so the
 * finding names the level rather than an index into a flat list.
 */
export interface SurfaceIssue {
  /** Stable, machine-checkable code. */
  code:
    | 'not-a-window'
    | 'malformed-id'
    | 'malformed-block'
    | 'too-many-windows'
    | 'too-many-open-surfaces'
    | 'no-tabs'
    | 'too-many-tabs'
    | 'duplicate-tab-id'
    | 'empty-tab'
    | 'too-many-blocks'
    | 'duplicate-block-id'
    | 'unknown-block-kind'
    | 'image-without-alt'
    | 'image-url-unsupported'
    | 'block-content-missing'
    | 'text-too-long'
    | 'list-too-long'
    | 'unknown-emphasis'
    | 'unknown-active-tab'
    | 'size-out-of-range';
  message: string;
  /** The window the issue names, or null when it is about the turn. */
  windowId: string | null;
  /** The tab within it, when the issue names one. */
  tabId: string | null;
  /** The block within that tab, when the issue names one. */
  blockId: string | null;
}

function issue(
  code: SurfaceIssue['code'],
  message: string,
  where: Partial<Pick<SurfaceIssue, 'windowId' | 'tabId' | 'blockId'>> = {},
): SurfaceIssue {
  return {
    code,
    message,
    windowId: where.windowId ?? null,
    tabId: where.tabId ?? null,
    blockId: where.blockId ?? null,
  };
}

/**
 * What a caller hands the collector.
 *
 * A window arrives without its timestamps, because the thing that raises it —
 * a model tool call, or an authored story — has no business inventing when it
 * was first put up. Emphasis is optional and defaults to `normal`: asking for
 * attention is a decision that has to be made on purpose, so it is never the
 * default.
 */
export type SurfaceWindowDraft = Omit<SurfaceWindow, 'createdAt' | 'updatedAt' | 'emphasis'> & {
  emphasis?: SurfaceEmphasis;
  /** Preserved when the caller knows the window's real origin. */
  createdAt?: string;
  updatedAt?: string;
};

/** A decision, with the findings attached when it is a refusal. */
export type Judged<T> = ({ ok: true } & T) | { ok: false; issues: SurfaceIssue[] };

export type SurfaceAccepted = Judged<{ window: SurfaceWindow; updated: boolean }>;
export type CloseAccepted = Judged<{ close: SurfaceClose }>;

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

const BLOCK_RULES: Record<
  SurfaceBlockKind,
  (block: SurfaceBlock, windowId: string, tabId: string) => SurfaceIssue[]
> = {
  text: (block, windowId, tabId) =>
    prose(block.text, MAX_BLOCK_TEXT_CHARS, 'text', windowId, tabId, block.id),
  // A picture with no description is unusable to anyone not looking at it, so
  // this is not a style preference — the host refuses to surface one.
  image: (block, windowId, tabId) => {
    const out: SurfaceIssue[] = [];
    if (typeof block.alt !== 'string' || block.alt.trim() === '') {
      out.push(
        issue('image-without-alt', `${block.id} is an image with no description of itself.`, {
          windowId,
          tabId,
          blockId: block.id,
        }),
      );
    }
    if (typeof block.url !== 'string' || !usableImageUrl(block.url)) {
      out.push(
        issue(
          'image-url-unsupported',
          `${block.id} needs an absolute https url or a workspace: reference, and got ${JSON.stringify(block.url ?? null)}.`,
          { windowId, tabId, blockId: block.id },
        ),
      );
    }
    return out;
  },
  code: (block, windowId, tabId) =>
    prose(block.text, MAX_BLOCK_TEXT_CHARS, 'code', windowId, tabId, block.id),
  list: (block, windowId, tabId) => {
    const items = block.items;
    if (!Array.isArray(items) || items.length === 0) {
      return [missing('list', windowId, tabId, block.id)];
    }
    const out: SurfaceIssue[] = [];
    if (items.length > MAX_LIST_ITEMS) {
      out.push(
        issue('list-too-long', `${block.id} has ${items.length} items, over the ${MAX_LIST_ITEMS} a list may hold.`, {
          windowId,
          tabId,
          blockId: block.id,
        }),
      );
    }
    for (const item of items) {
      const tooLong = typeof item === 'string' && item.length > MAX_LIST_ITEM_CHARS;
      if (tooLong) {
        out.push(
          issue('text-too-long', `An item of ${block.id} is ${item.length} characters, over ${MAX_LIST_ITEM_CHARS}.`, {
            windowId,
            tabId,
            blockId: block.id,
          }),
        );
      }
    }
    return out;
  },
  fields: (block, windowId, tabId) => {
    const fields = block.fields;
    if (!Array.isArray(fields) || fields.length === 0) {
      return [missing('fields', windowId, tabId, block.id)];
    }
    const out: SurfaceIssue[] = [];
    if (fields.length > MAX_FIELDS) {
      out.push(
        issue('list-too-long', `${block.id} has ${fields.length} fields, over the ${MAX_FIELDS} a table may hold.`, {
          windowId,
          tabId,
          blockId: block.id,
        }),
      );
    }
    for (const field of fields) {
      const label = typeof field?.label === 'string' ? field.label.length : 0;
      const value = typeof field?.value === 'string' ? field.value.length : 0;
      if (label > MAX_FIELD_LABEL_CHARS || value > MAX_FIELD_VALUE_CHARS) {
        out.push(
          issue('text-too-long', `A field of ${block.id} is longer than a label and a value may be.`, {
            windowId,
            tabId,
            blockId: block.id,
          }),
        );
      }
    }
    return out;
  },
  links: (block, windowId, tabId) => {
    const links = block.links;
    if (!Array.isArray(links) || links.length === 0) {
      return [missing('links', windowId, tabId, block.id)];
    }
    const out: SurfaceIssue[] = [];
    if (links.length > MAX_LINKS) {
      out.push(
        issue('list-too-long', `${block.id} has ${links.length} links, over the ${MAX_LINKS} it may hold.`, {
          windowId,
          tabId,
          blockId: block.id,
        }),
      );
    }
    for (const link of links) {
      if (typeof link?.label === 'string' && link.label.length > MAX_LINK_LABEL_CHARS) {
        out.push(
          issue('text-too-long', `A link label in ${block.id} is over ${MAX_LINK_LABEL_CHARS} characters.`, {
            windowId,
            tabId,
            blockId: block.id,
          }),
        );
      }
      if (typeof link?.href !== 'string' || !isAbsoluteHttp(link.href)) {
        out.push(
          issue('image-url-unsupported', `${block.id} has a link that is not an absolute http(s) url.`, {
            windowId,
            tabId,
            blockId: block.id,
          }),
        );
      }
    }
    return out;
  },
};

function missing(kind: string, windowId: string, tabId: string, blockId: string): SurfaceIssue {
  return issue('block-content-missing', `${blockId} is a ${kind} block with nothing in it.`, {
    windowId,
    tabId,
    blockId,
  });
}

function prose(
  value: unknown,
  limit: number,
  label: string,
  windowId: string,
  tabId: string,
  blockId: string,
): SurfaceIssue[] {
  if (typeof value !== 'string' || value.trim() === '') {
    return [missing(label, windowId, tabId, blockId)];
  }
  if (value.length > limit) {
    return [
      issue('text-too-long', `${blockId} is ${value.length} characters, over the ${limit} a ${label} block may hold.`, {
        windowId,
        tabId,
        blockId,
      }),
    ];
  }
  return [];
}

/** One block, checked on its own. Uniqueness among siblings is the window's job. */
export function validateBlock(
  block: SurfaceBlock,
  where: { windowId: string; tabId: string },
): SurfaceIssue[] {
  const located = { windowId: where.windowId, tabId: where.tabId, blockId: block?.id ?? null };
  if (!block || typeof block !== 'object' || !wellFormedId(block.id)) {
    return [issue('malformed-block', `${where.tabId} has a block with no usable id.`, located)];
  }

  const out: SurfaceIssue[] = [];
  if (!Object.prototype.hasOwnProperty.call(BLOCK_KINDS, block.kind)) {
    out.push(
      issue(
        'unknown-block-kind',
        `${block.id} is a "${String(block.kind)}" block. The kinds are text, image, code, list, fields and links.`,
        located,
      ),
    );
    // The kind decides which fields are required, so there is nothing more to
    // check that would be true.
    return out;
  }

  if (block.title !== undefined && block.title.length > MAX_BLOCK_TITLE_CHARS) {
    out.push(
      issue(
        'text-too-long',
        `The title of ${block.id} is ${block.title.length} characters, over ${MAX_BLOCK_TITLE_CHARS}.`,
        located,
      ),
    );
  }
  if (block.caption !== undefined && block.caption.length > MAX_CAPTION_CHARS) {
    out.push(
      issue(
        'text-too-long',
        `The caption of ${block.id} is ${block.caption.length} characters, over ${MAX_CAPTION_CHARS}.`,
        located,
      ),
    );
  }

  out.push(...BLOCK_RULES[block.kind](block, where.windowId, where.tabId));
  return out;
}

/** One tab, checked in the context of its window. */
export function validateTab(tab: SurfaceTab, windowId: string): SurfaceIssue[] {
  if (!tab || typeof tab !== 'object' || !wellFormedId(tab.id)) {
    return [issue('malformed-id', 'A tab has no usable id.', { windowId })];
  }
  if (typeof tab.title !== 'string' || tab.title.trim() === '') {
    return [issue('malformed-id', `The tab ${tab.id} has no title.`, { windowId, tabId: tab.id })];
  }

  const out: SurfaceIssue[] = [];
  if (tab.title.length > MAX_TAB_TITLE_CHARS) {
    out.push(
      issue(
        'text-too-long',
        `The title of ${tab.id} is ${tab.title.length} characters, over ${MAX_TAB_TITLE_CHARS}.`,
        { windowId, tabId: tab.id },
      ),
    );
  }
  if (tab.badge !== undefined && tab.badge.length > MAX_BADGE_CHARS) {
    out.push(
      issue(
        'text-too-long',
        `The badge on ${tab.id} is ${tab.badge.length} characters, over ${MAX_BADGE_CHARS}.`,
        { windowId, tabId: tab.id },
      ),
    );
  }

  const blocks = Array.isArray(tab.blocks) ? tab.blocks : [];
  // An empty tab is a heading with nothing under it. Showing it would be a
  // window that looks broken rather than a window that is short.
  if (blocks.length === 0) {
    out.push(issue('empty-tab', `The tab ${tab.id} has no blocks in it.`, { windowId, tabId: tab.id }));
  }
  if (blocks.length > MAX_SURFACE_BLOCKS_PER_TAB) {
    out.push(
      issue('too-many-blocks', `${tab.id} has ${blocks.length} blocks, over the ${MAX_SURFACE_BLOCKS_PER_TAB} a tab may hold.`, {
        windowId,
        tabId: tab.id,
      }),
    );
  }

  const seen = new Set<string>();
  for (const block of blocks) {
    const id = typeof block?.id === 'string' ? block.id : '';
    // Two blocks with one id make the window's own address ambiguous: a later
    // update to that id would have to pick one of them.
    if (id && seen.has(id)) {
      out.push(
        issue('duplicate-block-id', `${tab.id} has two blocks called ${id}. Block ids are unique within a tab.`, {
          windowId,
          tabId: tab.id,
          blockId: id,
        }),
      );
      continue;
    }
    seen.add(id);
    out.push(...validateBlock(block, { windowId, tabId: tab.id }));
  }
  return out;
}

/**
 * One window, checked whole.
 *
 * This is the check the client would otherwise have to make, and it is here
 * rather than there because a refusal the model can read is worth more than a
 * rendering guard that silently drops a tab.
 */
export function validateWindow(window: SurfaceWindowDraft): SurfaceIssue[] {
  if (!window || typeof window !== 'object') {
    return [issue('not-a-window', 'A window needs at least an id, a title and a tab.')];
  }
  if (!wellFormedId(window.id)) {
    return [
      issue(
        'malformed-id',
        `"${String(window.id)}" is not usable as a window id. Ids are lower-case letters, digits and hyphens, and they are matched exactly.`,
      ),
    ];
  }
  const windowId = window.id;
  const out: SurfaceIssue[] = [];

  if (typeof window.title !== 'string' || window.title.trim() === '') {
    out.push(issue('not-a-window', `${windowId} has no title.`, { windowId }));
  } else if (window.title.length > MAX_WINDOW_TITLE_CHARS) {
    out.push(
      issue(
        'text-too-long',
        `The title of ${windowId} is ${window.title.length} characters, over ${MAX_WINDOW_TITLE_CHARS}.`,
        { windowId },
      ),
    );
  }
  if (window.subtitle !== undefined && window.subtitle.length > MAX_WINDOW_SUBTITLE_CHARS) {
    out.push(
      issue(
        'text-too-long',
        `The subtitle of ${windowId} is ${window.subtitle.length} characters, over ${MAX_WINDOW_SUBTITLE_CHARS}.`,
        { windowId },
      ),
    );
  }
  if (window.raisedBy !== undefined && window.raisedBy.length > MAX_RAISED_BY_CHARS) {
    out.push(
      issue(
        'text-too-long',
        `raisedBy on ${windowId} is ${window.raisedBy.length} characters, over ${MAX_RAISED_BY_CHARS}.`,
        { windowId },
      ),
    );
  }
  if (window.emphasis !== undefined && !Object.prototype.hasOwnProperty.call(EMPHASIS_VALUES, window.emphasis)) {
    out.push(
      issue('unknown-emphasis', `"${String(window.emphasis)}" is not an emphasis. Use quiet, normal or attention.`, {
        windowId,
      }),
    );
  }
  if (window.size) {
    const { width, height } = window.size;
    if (!inWindowSideRange(width) || !inWindowSideRange(height)) {
      out.push(
        issue(
          'size-out-of-range',
          `${windowId} asks for ${String(width)}x${String(height)}. A reference size is between ${MIN_WINDOW_SIDE} and ${MAX_WINDOW_SIDE} pixels a side.`,
          { windowId },
        ),
      );
    }
  }

  const tabs = Array.isArray(window.tabs) ? window.tabs : [];
  // A window with no tabs is a frame around nothing.
  if (tabs.length === 0) {
    out.push(issue('no-tabs', `${windowId} has no tabs, so there is nothing in it.`, { windowId }));
    return out;
  }
  if (tabs.length > MAX_SURFACE_TABS_PER_WINDOW) {
    out.push(
      issue(
        'too-many-tabs',
        `${windowId} has ${tabs.length} tabs, over the ${MAX_SURFACE_TABS_PER_WINDOW} a window may hold.`,
        { windowId },
      ),
    );
  }

  const tabIds = new Set<string>();
  for (const tab of tabs) {
    const id = typeof tab?.id === 'string' ? tab.id : '';
    if (id && tabIds.has(id)) {
      out.push(
        issue('duplicate-tab-id', `${windowId} has two tabs called ${id}. Tab ids are unique within a window.`, {
          windowId,
          tabId: id,
        }),
      );
      continue;
    }
    tabIds.add(id);
    out.push(...validateTab(tab, windowId));
  }

  if (window.activeTabId !== undefined && !tabIds.has(window.activeTabId)) {
    out.push(
      issue(
        'unknown-active-tab',
        `${windowId} wants to bring "${String(window.activeTabId)}" forward, and no tab has that id.`,
        { windowId },
      ),
    );
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Attention                                                           */
/* ------------------------------------------------------------------ */

/**
 * How loudly a surface may ask, given how many are already up.
 *
 * `emphasis` is the host's only lever on attention, and `attention` is the one
 * case where a window arrives on top of what the person is looking at. It is
 * spent rarely, because a surface that always demands attention is one nobody
 * reads. So the ladder tightens as the screen fills:
 *
 *   0-2 open   the request stands. There is room for a window to be the thing
 *              being looked at, so asking is a real choice the caller can make.
 *   3-5 open   `attention` becomes `normal`. Enough is on screen that nothing
 *              new should claim the top spot, but a window may still be one of
 *              the things being read.
 *   6-8 open   one step down again: `attention` becomes `normal`, and `normal`
 *              becomes `quiet`. At this many, a window that asks for the middle
 *              is asking for attention the person has no spare — so nothing
 *              raises the screen, and it arrives as available rather than as a
 *              claim.
 *   9 or more  everything is `quiet`. Twelve things cannot each be attended to,
 *              and keeping some of them loud would be a lie about attention
 *              rather than a policy about it.
 *
 * Nothing is dropped at any rung. Count is the one thing the host does not
 * negotiate; manner is what it spends more carefully. The ladder runs out at
 * `MAX_OPEN_SURFACES`, which is a refusal, not a demotion.
 */
export function restraintFor(openCount: number, requested: SurfaceEmphasis): SurfaceEmphasis {
  if (openCount >= 9) return 'quiet';
  if (openCount >= 6) return requested === 'attention' ? 'normal' : 'quiet';
  if (openCount >= 3) return requested === 'attention' ? 'normal' : requested;
  return requested;
}

/* ------------------------------------------------------------------ */
/* The collector                                                       */
/* ------------------------------------------------------------------ */

/**
 * Everything one turn wants shown, in the order it was asked for.
 *
 * One collector per turn, and it is the only thing that may write to it. The
 * plan it produces is a *delta* — windows to raise or update, ids to close —
 * rather than the client's whole window set, because the client is the
 * authority on what is open and an id is stable across turns precisely so that
 * a second turn about the same thing updates the window already on screen.
 */
export class SurfaceCollector {
  /** Ids believed to be open before this turn, as far as the host knows. */
  private readonly believed = new Set<string>();
  private readonly raised = new Map<string, SurfaceWindow>();
  private readonly closes = new Map<string, SurfaceClose>();

  /**
   * `openBefore` is how many windows the screen already holds.
   *
   * The host does not persist the client's window set, so a turn that is not
   * told otherwise assumes an empty screen and counts only what it raises
   * itself. That keeps the ladder honest about what it can see, and keeps a
   * stale count from another session from permanently dimming this one.
   */
  constructor(openBefore = 0) {
    for (let i = 0; i < openBefore; i++) this.believed.add(`open-${i}`);
  }

  /**
   * Raises a window, or updates the one already carrying that id.
   *
   * Re-opening an id is an update, not a conflict: that is what makes "always a
   * step ahead" mean the thing you were looking at changes under you instead of
   * a new thing arriving beside it. Everything else that goes wrong — too many
   * windows, a tab with no blocks, a picture with no description — comes back
   * as findings.
   */
  open(draft: SurfaceWindowDraft): SurfaceAccepted {
    const issues = validateWindow(draft);
    if (issues.length > 0) return { ok: false, issues };

    const id = draft.id;
    const existing = this.raised.get(id) ?? null;
    const known = existing !== null || this.believed.has(id);

    const refusals: SurfaceIssue[] = [];
    if (!known && this.raised.size >= MAX_SURFACE_WINDOWS_PER_TURN) {
      refusals.push(
        issue(
          'too-many-windows',
          `This turn has already raised ${MAX_SURFACE_WINDOWS_PER_TURN} windows, which is as many as one turn may.`,
          { windowId: id },
        ),
      );
    }
    if (!known && this.openCount() >= MAX_OPEN_SURFACES) {
      refusals.push(
        issue('too-many-open-surfaces', `${MAX_OPEN_SURFACES} windows are already open. Close one and this can be raised.`, {
          windowId: id,
        }),
      );
    }
    if (refusals.length > 0) return { ok: false, issues: refusals };

    // The count this window joins includes itself, because that is the screen
    // the person will actually be looking at once it is up.
    const arriving = known ? 0 : 1;
    const emphasis = restraintFor(this.openCount() + arriving, draft.emphasis ?? 'normal');
    const now = new Date().toISOString();

    const window: SurfaceWindow = {
      ...draft,
      emphasis,
      // The origin of a window is the first time this turn saw it. The client
      // does the same across turns, so an updated window does not jump to the
      // front of the cascade every time its contents change.
      createdAt: existing?.createdAt ?? draft.createdAt ?? now,
      updatedAt: now,
    };

    // Replacing keeps the original insertion position: the raise order decides
    // what a crowded screen drops, and an update is not a re-raise.
    this.raised.set(id, window);
    this.closes.delete(id);
    return { ok: true, window, updated: known };
  }

  /**
   * Asks for a window to be taken down.
   *
   * Closing an id this turn never raised is accepted: the client may hold a
   * window the host has no record of, and a close for something that is not
   * there is a no-op rather than an error. A malformed id is refused, because
   * that is a caller who has misunderstood the address rather than a screen
   * that has moved on.
   */
  close(id: string, reason?: string): CloseAccepted {
    if (!wellFormedId(id)) {
      return {
        ok: false,
        issues: [issue('malformed-id', `"${id}" is not usable as a window id to close.`)],
      };
    }
    const close: SurfaceClose = { id, ...(reason ? { reason } : {}) };
    this.closes.set(id, close);
    return { ok: true, close };
  }

  /** How many windows the host believes will be open once this turn is applied. */
  openCount(): number {
    const live = new Set(this.believed);
    for (const id of this.raised.keys()) live.add(id);
    for (const id of this.closes.keys()) live.delete(id);
    return live.size;
  }

  /** True when this turn has something to say about the screen. */
  changed(): boolean {
    return this.raised.size > 0 || this.closes.size > 0;
  }

  /**
   * What to send.
   *
   * `complete` is always true here: this is one turn's whole intention, and
   * anything it does not mention is something it is leaving alone. The client
   * applies `close` after `windows`, so a turn that raises a replacement and
   * closes its predecessor does both in one pass without the ids colliding.
   */
  plan(): SurfacePlan {
    return {
      windows: [...this.raised.values()],
      close: [...this.closes.values()],
      complete: true,
    };
  }
}

/** A plan that wants nothing, for a path that has no surfaces to offer. */
export function emptySurfacePlan(): SurfacePlan {
  return { windows: [], close: [], complete: true };
}

/**
 * The wire shape, from a plan and a costume.
 *
 * `plan` is null when nothing changed, which is the one signal the client uses
 * to skip a render: an empty plan object and no plan at all carry the same
 * information, and the field's contract is that null means "nothing moved".
 * The windows and close ids are sent either way, so a client that reads those
 * directly still sees the truth.
 */
export function turnSurfaces(plan: SurfacePlan, persona: PersonaWear | null): TurnSurfaces {
  const moved = plan.windows.length > 0 || plan.close.length > 0;
  return {
    windows: plan.windows,
    close: plan.close.map((c) => c.id),
    plan: moved ? plan : null,
    persona,
  };
}

/* ------------------------------------------------------------------ */
/* Small checks                                                        */
/* ------------------------------------------------------------------ */

function wellFormedId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_CHARS && WELL_FORMED_ID.test(id);
}

function inWindowSideRange(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= MIN_WINDOW_SIDE && value <= MAX_WINDOW_SIDE;
}

/** An image reference the client is allowed to fetch. */
export function usableImageUrl(url: string): boolean {
  return WORKSPACE_REF.test(url) || isAbsoluteHttps(url);
}

function isAbsoluteHttps(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

function isAbsoluteHttp(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}
