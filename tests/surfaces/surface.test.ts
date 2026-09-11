import { describe, it, expect } from 'vitest';
import {
  MAX_BLOCK_TEXT_CHARS,
  MAX_LIST_ITEMS,
  MAX_WINDOW_TITLE_CHARS,
  MIN_WINDOW_SIDE,
  SurfaceCollector,
  emptySurfacePlan,
  restraintFor,
  turnSurfaces,
  validateBlock,
  validateWindow,
  type SurfaceIssue,
  type SurfaceWindowDraft,
} from '../../src/worker/surfaces/surface';
import { chooseIndex, evaluate, type ActionOutcome } from '../../src/worker/ink/runtime';
import { presentationInline } from '../../src/worker/registry/surface-natives';
import { PersonaSlot } from '../../src/worker/personas/wear';
import { getStory } from '../../src/worker/stories/registry';
import {
  MAX_OPEN_SURFACES,
  MAX_SURFACE_WINDOWS_PER_TURN,
  type PersonaWear,
  type SurfaceEmphasis,
} from '../../src/shared/types';

/**
 * Tests for the surface collector.
 *
 * Two of these properties are the ones the feature stands on and the ones most
 * easily lost in a refactor: that the restraint ladder tightens monotonically
 * without ever dropping a window, and that a refusal names what was wrong
 * instead of quietly shortening the thing. Several cases below assert exactly
 * that — that the tenth window still arrives, and that an over-long block comes
 * back as a finding rather than as a truncated one.
 */

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function draft(over: Partial<SurfaceWindowDraft> = {}): SurfaceWindowDraft {
  return {
    id: 'budget',
    title: 'Budget',
    tabs: [{ id: 'main', title: 'Budget', blocks: [{ id: 'body', kind: 'text', text: 'Numbers.' }] }],
    ...over,
  };
}

function image(over: Record<string, unknown> = {}) {
  return { id: 'shot', kind: 'image', url: 'https://example.test/a.png', alt: 'A wide shot.', ...over };
}

function codes(issues: SurfaceIssue[]): string[] {
  return issues.map((issue) => issue.code);
}

function accepted<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`expected an acceptance, got ${JSON.stringify(result)}`);
  return result as Extract<T, { ok: true }>;
}

function refused<T extends { ok: boolean }>(result: T): Extract<T, { ok: false }> {
  if (result.ok) throw new Error('expected a refusal, got an acceptance');
  return result as Extract<T, { ok: false }>;
}

/* ------------------------------------------------------------------ */
/* The restraint ladder                                                */
/* ------------------------------------------------------------------ */

describe('restraintFor', () => {
  /*
   * The whole ladder, rung by rung, rather than a sample of it. The boundaries
   * are the entire content of this policy: a change that moved one of them by a
   * single window would be invisible in a spot check and obvious here.
   */
  const ladder: { open: number; requested: SurfaceEmphasis; expected: SurfaceEmphasis }[] = [
    { open: 0, requested: 'attention', expected: 'attention' },
    { open: 0, requested: 'normal', expected: 'normal' },
    { open: 0, requested: 'quiet', expected: 'quiet' },
    { open: 2, requested: 'attention', expected: 'attention' },
    // 3-5: nothing new claims the top spot, but a window may still be read.
    { open: 3, requested: 'attention', expected: 'normal' },
    { open: 3, requested: 'normal', expected: 'normal' },
    { open: 3, requested: 'quiet', expected: 'quiet' },
    { open: 5, requested: 'attention', expected: 'normal' },
    { open: 5, requested: 'normal', expected: 'normal' },
    // 6-8: a window asking for the middle is asking for attention there is none
    // of, so it arrives as available rather than as a claim.
    { open: 6, requested: 'attention', expected: 'normal' },
    { open: 6, requested: 'normal', expected: 'quiet' },
    { open: 6, requested: 'quiet', expected: 'quiet' },
    { open: 8, requested: 'normal', expected: 'quiet' },
    // 9-11: keeping any of them loud would be a lie about attention.
    { open: 9, requested: 'attention', expected: 'quiet' },
    { open: 9, requested: 'normal', expected: 'quiet' },
    { open: MAX_OPEN_SURFACES, requested: 'attention', expected: 'quiet' },
  ];

  for (const rung of ladder) {
    it(`with ${rung.open} open, ${rung.requested} becomes ${rung.expected}`, () => {
      expect(restraintFor(rung.open, rung.requested)).toBe(rung.expected);
    });
  }

  it('never raises what was asked for', () => {
    const rank: Record<SurfaceEmphasis, number> = { quiet: 0, normal: 1, attention: 2 };
    for (let open = 0; open <= 20; open++) {
      for (const requested of ['quiet', 'normal', 'attention'] as SurfaceEmphasis[]) {
        expect(rank[restraintFor(open, requested)]).toBeLessThanOrEqual(rank[requested]);
      }
    }
  });

  it('tightens monotonically as the screen fills', () => {
    let previous = 2;
    for (let open = 0; open <= 20; open++) {
      const level = { quiet: 0, normal: 1, attention: 2 }[restraintFor(open, 'attention')];
      expect(level).toBeLessThanOrEqual(previous);
      previous = level;
    }
  });

  /*
   * The rule under the ladder: count is not what the host negotiates. If this
   * ever fails, the failure is that something was silently withheld from
   * someone who asked for it, which is the one outcome the module refuses.
   */
  it('drops nothing for being numerous', () => {
    const collector = new SurfaceCollector(MAX_OPEN_SURFACES - 1);
    const first = collector.open(draft({ id: 'last-one', emphasis: 'attention' }));
    const window = accepted(first).window;
    expect(window.emphasis).toBe('quiet');
    expect(collector.plan().windows.map((w) => w.id)).toEqual(['last-one']);
  });
});

/* ------------------------------------------------------------------ */
/* Raising and updating                                                */
/* ------------------------------------------------------------------ */

describe('SurfaceCollector', () => {
  it('treats a repeated id as an update, not a conflict', () => {
    const collector = new SurfaceCollector();
    const first = accepted(collector.open(draft()));
    const second = accepted(collector.open(draft({ title: 'Budget, revised' })));

    expect(first.updated).toBe(false);
    expect(second.updated).toBe(true);
    // One window, not two, and the original insertion position is kept so an
    // update does not jump the queue on a crowded screen.
    expect(collector.plan().windows).toHaveLength(1);
    expect(collector.openCount()).toBe(1);
    expect(second.window.createdAt).toBe(first.window.createdAt);
    expect(second.window.title).toBe('Budget, revised');
  });

  it('defaults emphasis to normal rather than to attention', () => {
    const collector = new SurfaceCollector();
    expect(accepted(collector.open(draft())).window.emphasis).toBe('normal');
  });

  it('counts itself when deciding how loudly it may ask', () => {
    const collector = new SurfaceCollector();
    collector.open(draft({ id: 'a' }));
    collector.open(draft({ id: 'b' }));
    // The third window arrives onto a screen of three, so the ladder's second
    // rung applies to it and not to the screen it left behind.
    expect(accepted(collector.open(draft({ id: 'c', emphasis: 'attention' }))).window.emphasis).toBe('normal');
  });

  it(`refuses the ${MAX_SURFACE_WINDOWS_PER_TURN + 1}th window of one turn`, () => {
    const collector = new SurfaceCollector();
    for (let i = 0; i < MAX_SURFACE_WINDOWS_PER_TURN; i++) {
      expect(collector.open(draft({ id: `w${i}` })).ok).toBe(true);
    }
    expect(codes(refused(collector.open(draft({ id: 'one-too-many' }))).issues)).toEqual(['too-many-windows']);
    // The ceiling is on windows, not on calls: updating one already raised is
    // still allowed, because that adds nothing to the screen.
    expect(collector.open(draft({ id: 'w0', title: 'Still here' })).ok).toBe(true);
  });

  it('refuses a window onto a screen that is already full', () => {
    const collector = new SurfaceCollector(MAX_OPEN_SURFACES);
    expect(codes(refused(collector.open(draft())).issues)).toEqual(['too-many-open-surfaces']);
  });

  it('reports the whole plan, complete, and says when nothing moved', () => {
    const quiet = new SurfaceCollector();
    expect(turnSurfaces(quiet.plan(), null).plan).toBeNull();
    expect(quiet.changed()).toBe(false);

    quiet.open(draft({ id: 'a' }));
    quiet.open(draft({ id: 'b' }));
    quiet.close('b', 'not needed');

    const plan = quiet.plan();
    expect(plan.complete).toBe(true);
    // Both windows are in the plan and one is in `close`: the client applies
    // the closes after the raises, so a turn never has to sequence them itself.
    expect(plan.windows.map((w) => w.id)).toEqual(['a', 'b']);
    expect(plan.close.map((c) => c.id)).toEqual(['b']);
    expect(plan.close[0]?.reason).toBe('not needed');
    // The count, though, is the screen as it will be once the turn is applied.
    expect(quiet.openCount()).toBe(1);
  });

  it('lets a turn replace a window and close its predecessor in one pass', () => {
    const collector = new SurfaceCollector();
    collector.open(draft({ id: 'old' }));
    collector.open(draft({ id: 'new' }));
    collector.close('old', 'folded into new');

    const plan = collector.plan();
    expect(plan.windows.map((w) => w.id)).toEqual(['old', 'new']);
    expect(plan.close.map((c) => c.id)).toEqual(['old']);
  });

  it('raises a window again after it was closed in the same turn', () => {
    const collector = new SurfaceCollector();
    collector.open(draft({ id: 'a' }));
    collector.close('a');
    collector.open(draft({ id: 'a', title: 'Back' }));

    expect(collector.plan().close).toEqual([]);
    expect(collector.plan().windows).toHaveLength(1);
  });

  it('accepts a close for a window it never raised, because the client may hold it', () => {
    const collector = new SurfaceCollector();
    expect(accepted(collector.close('something-else', 'the client knows')).close.id).toBe('something-else');
  });

  it('refuses a close addressed to something that is not an id', () => {
    const collector = new SurfaceCollector();
    expect(codes(refused(collector.close('Not An Id')).issues)).toEqual(['malformed-id']);
  });

  it('carries the costume on the wire whether or not the screen moved', () => {
    const collector = new SurfaceCollector();
    const persona = { persona: { id: 'archivist' }, bitId: null, expiresAt: 'x', reason: 'y' } as unknown as PersonaWear;
    const wire = turnSurfaces(emptySurfacePlan(), persona);
    expect(wire.plan).toBeNull();
    expect(wire.persona).toBe(persona);
    expect(wire.windows).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* What a window may contain                                           */
/* ------------------------------------------------------------------ */

describe('validateWindow', () => {
  it('accepts a window with one text block', () => {
    expect(validateWindow(draft())).toEqual([]);
  });

  it('refuses a window with no tabs, because a frame around nothing is not a window', () => {
    expect(codes(validateWindow(draft({ tabs: [] })))).toEqual(['no-tabs']);
  });

  it('refuses a tab with no blocks, because a heading over nothing looks broken', () => {
    expect(codes(validateWindow(draft({ tabs: [{ id: 'main', title: 'Main', blocks: [] }] })))).toEqual(['empty-tab']);
  });

  it('refuses two tabs sharing an id, and two blocks sharing one', () => {
    const tabs = [
      { id: 'main', title: 'Main', blocks: [{ id: 'body', kind: 'text' as const, text: 'One.' }] },
      { id: 'main', title: 'Also main', blocks: [{ id: 'body', kind: 'text' as const, text: 'Two.' }] },
    ];
    expect(codes(validateWindow(draft({ tabs })))).toContain('duplicate-tab-id');

    const blocks = [
      { id: 'body', kind: 'text' as const, text: 'One.' },
      { id: 'body', kind: 'text' as const, text: 'Two.' },
    ];
    expect(codes(validateWindow(draft({ tabs: [{ id: 'main', title: 'Main', blocks }] })))).toContain(
      'duplicate-block-id',
    );
  });

  it('refuses a tab it is told to bring forward when no tab has that id', () => {
    expect(codes(validateWindow(draft({ activeTabId: 'elsewhere' })))).toEqual(['unknown-active-tab']);
  });

  it('refuses an id that is not an address', () => {
    expect(codes(validateWindow(draft({ id: 'Budget Window' })))).toEqual(['malformed-id']);
  });

  it('refuses an emphasis outside the three there are', () => {
    const issues = validateWindow(draft({ emphasis: 'loud' as SurfaceEmphasis }));
    expect(codes(issues)).toEqual(['unknown-emphasis']);
  });

  it('refuses a size outside the reference range the client clamps to', () => {
    expect(codes(validateWindow(draft({ size: { width: MIN_WINDOW_SIDE - 1, height: 600 } })))).toEqual([
      'size-out-of-range',
    ]);
    expect(validateWindow(draft({ size: { width: MIN_WINDOW_SIDE, height: 600 } }))).toEqual([]);
  });

  /*
   * The property the whole file exists for. A title cut at a hundred and twenty
   * characters ends mid-word with nothing on screen admitting that the rest was
   * ever there, so the refusal is the only outcome that keeps the host honest.
   */
  it('refuses an over-long title rather than shortening it', () => {
    const title = 'x'.repeat(MAX_WINDOW_TITLE_CHARS + 1);
    const issues = validateWindow(draft({ title }));
    expect(codes(issues)).toEqual(['text-too-long']);
    expect(issues[0]?.message).toContain(String(title.length));

    const atLimit = validateWindow(draft({ title: 'x'.repeat(MAX_WINDOW_TITLE_CHARS) }));
    expect(atLimit).toEqual([]);
  });

  it('refuses an over-long block rather than truncating it', () => {
    const text = 'y'.repeat(MAX_BLOCK_TEXT_CHARS + 1);
    const issues = validateBlock({ id: 'body', kind: 'text', text }, { windowId: 'budget', tabId: 'main' });
    expect(codes(issues)).toEqual(['text-too-long']);
    expect(issues[0]).toMatchObject({ windowId: 'budget', tabId: 'main', blockId: 'body' });
  });

  it('refuses a block kind the renderer never agreed to draw', () => {
    const issues = validateBlock(
      { id: 'x', kind: 'hologram' as never },
      { windowId: 'budget', tabId: 'main' },
    );
    expect(codes(issues)).toEqual(['unknown-block-kind']);
  });

  it('refuses a block with no usable id', () => {
    expect(codes(validateBlock({ id: '', kind: 'text', text: 'x' }, { windowId: 'w', tabId: 't' }))).toEqual([
      'malformed-block',
    ]);
  });

  it('refuses a block whose kind needs content and has none', () => {
    expect(codes(validateBlock({ id: 'l', kind: 'list', items: [] }, { windowId: 'w', tabId: 't' }))).toEqual([
      'block-content-missing',
    ]);
    expect(codes(validateBlock({ id: 't', kind: 'text', text: '   ' }, { windowId: 'w', tabId: 't' }))).toEqual([
      'block-content-missing',
    ]);
  });

  it('refuses a list past the ceiling in items or in item length', () => {
    const many = Array.from({ length: MAX_LIST_ITEMS + 1 }, (_, i) => `item ${i}`);
    expect(codes(validateBlock({ id: 'l', kind: 'list', items: many }, { windowId: 'w', tabId: 't' }))).toEqual([
      'list-too-long',
    ]);

    const long = ['z'.repeat(401)];
    expect(codes(validateBlock({ id: 'l', kind: 'list', items: long }, { windowId: 'w', tabId: 't' }))).toEqual([
      'text-too-long',
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* The story path                                                      */
/* ------------------------------------------------------------------ */

/*
 * The authored story calls the same four capabilities the model calls as
 * tools, positionally, and gets an answer without a dispatch. Nothing else in
 * the suite connects the two halves: the Ink harness checks that a call's
 * argument count matches its declaration, and this checks that the declaration
 * matches what the resolver actually reads. A story that passed `title` and
 * `body` in the other order would satisfy every other check in the repository.
 */
describe('show-and-tell', () => {
  const compiled = () => {
    const story = getStory('show-and-tell');
    if (!story) throw new Error('the show-and-tell story is no longer published');
    return story;
  };

  function run(
    stateJson: string | null,
    channels: { surfaces: SurfaceCollector; persona: PersonaSlot },
    memo: Map<string, ActionOutcome>,
  ) {
    const story = compiled();
    return evaluate({
      compiled: story.compiled,
      stateJson,
      entryKnot: story.entryKnot,
      memo,
      readableConfig: {},
      riskFor: () => 'none',
      inline: presentationInline(channels),
    });
  }

  it('raises its window without leaving the pass', async () => {
    const surfaces = new SurfaceCollector();
    const persona = new PersonaSlot();
    const memo = new Map<string, ActionOutcome>();

    const first = await run(null, { surfaces, persona }, memo);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // No yield: every external the story used was answered inline, so there was
    // nothing for the dispatcher to do.
    expect(first.value.pendingAction).toBeNull();
    expect(first.value.text).toContain('It is beside this, not in it.');
    expect(first.value.resolvedActions).toHaveLength(1);

    const window = surfaces.plan().windows[0];
    expect(window?.id).toBe('show-and-tell');
    expect(window?.title).toBe('Show and tell');
    expect(window?.tabs[0]?.blocks[0]).toMatchObject({ kind: 'text' });
    expect(window?.emphasis).toBe('normal');
  });

  it('dresses and undresses, and takes the window down, on later choices', async () => {
    const surfaces = new SurfaceCollector();
    const persona = new PersonaSlot();
    const memo = new Map<string, ActionOutcome>();

    const opened = await run(null, { surfaces, persona }, memo);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const labels = opened.value.choices.map((choice) => choice.text);
    expect(labels).toContain('Wear the archivist while it is up');

    // Choosing is navigation; the action happens on the evaluation after it.
    const wornState = chooseIndex(compiled().compiled, opened.value.stateJson, labels.indexOf('Wear the archivist while it is up'));
    expect(wornState.ok).toBe(true);
    if (!wornState.ok) return;

    const dressed = await run(wornState.value, { surfaces, persona }, memo);
    expect(dressed.ok).toBe(true);
    if (!dressed.ok) return;
    const worn = persona.current();
    expect(worn?.persona.id).toBe('archivist');
    expect(worn?.bitId).toBe('filed');
    expect(worn?.reason).toBe('a window full of documents deserves one');

    const nextLabels = dressed.value.choices.map((choice) => choice.text);
    expect(nextLabels).toContain('Take the costume off');
    expect(nextLabels).not.toContain('Wear the archivist while it is up');

    const downState = chooseIndex(compiled().compiled, dressed.value.stateJson, nextLabels.indexOf('Take the window down'));
    expect(downState.ok).toBe(true);
    if (!downState.ok) return;

    const gone = await run(downState.value, { surfaces, persona }, memo);
    expect(gone.ok).toBe(true);
    if (!gone.ok) return;
    expect(gone.value.text).toContain('It is down.');
    expect(surfaces.plan().close.map((c) => c.id)).toEqual(['show-and-tell']);
    // The costume was left on: taking the window down is not taking the hat off.
    expect(persona.current()?.persona.id).toBe('archivist');
  });

  it('files an inline answer in the memo, so replay does not repeat it', async () => {
    const surfaces = new SurfaceCollector();
    const persona = new PersonaSlot();
    const memo = new Map<string, ActionOutcome>();

    const first = await run(null, { surfaces, persona }, memo);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(memo.size).toBe(1);

    // A second pass from the same snapshot, as the dispatch loop makes after a
    // real action, resolves from the memo: one window either way, and the
    // resolver is not consulted again.
    const replay = await run(null, { surfaces, persona }, memo);
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.value.resolvedActions).toEqual(first.value.resolvedActions);
    expect(surfaces.plan().windows).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/* Pictures                                                            */
/* ------------------------------------------------------------------ */

describe('image blocks', () => {
  const where = { windowId: 'w', tabId: 't' };

  it('accepts an absolute https url and a workspace reference', () => {
    expect(validateBlock(image() as never, where)).toEqual([]);
    expect(validateBlock(image({ url: 'workspace:chart.png' }) as never, where)).toEqual([]);
  });

  /*
   * A picture with no description is unusable to anyone not looking at it, so
   * the alt text is a condition of surfacing the block rather than a nicety.
   */
  it('refuses an image with no description of itself', () => {
    expect(codes(validateBlock(image({ alt: '' }) as never, where))).toEqual(['image-without-alt']);
    expect(codes(validateBlock(image({ alt: '   ' }) as never, where))).toEqual(['image-without-alt']);
    const absent = image();
    delete (absent as Record<string, unknown>).alt;
    expect(codes(validateBlock(absent as never, where))).toEqual(['image-without-alt']);
  });

  it('refuses http, data uris and anything that is not a reference', () => {
    for (const url of ['http://example.test/a.png', 'data:image/png;base64,AAAA', '/local/a.png', 'javascript:alert(1)']) {
      expect(codes(validateBlock(image({ url }) as never, where))).toEqual(['image-url-unsupported']);
    }
  });

  it('refuses a link that is not absolute', () => {
    const block = { id: 'docs', kind: 'links', links: [{ label: 'Docs', href: '/docs' }] };
    expect(codes(validateBlock(block as never, where))).toEqual(['image-url-unsupported']);
  });
});
