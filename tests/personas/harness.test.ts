import { describe, it, expect } from 'vitest';
import type { Persona, PersonaTraitKind } from '../../src/shared/types';
import { MAX_PERSONA_LINES_PER_BIT, MAX_PERSONA_LINE_CHARS, MAX_PERSONA_TRAITS } from '../../src/shared/types';
import {
  MAX_PERSONA_DURATION_MS,
  MIN_PERSONA_DURATION_MS,
  MIN_TRAIT_CONTRAST,
  MAX_TRAIT_OFFSET,
  PERSONA_CAVEAT,
  validatePersona,
} from '../../src/worker/personas/harness';
import { AUTHORED_PERSONAS, authoredPersona } from '../../src/worker/personas/authored';
import { PersonaSlot } from '../../src/worker/personas/wear';
import {
  TRAIT_REGIONS,
  TRAIT_ROLES,
  TRAIT_VOCABULARY,
  regionContains,
  type TraitRole,
} from '../../src/worker/personas/vocabulary';
import { contrastRatio, hexToRgb, normaliseColor } from '../../src/worker/design/math';

/**
 * Tests for the persona harness.
 *
 * The interesting cases are the ones where a costume is *nearly* fine. A
 * costume is a closed vocabulary of ornaments on a shell, so almost every way it
 * can be wrong is a number: a colour too close to the shell, a nudge that puts
 * two things in the same place, a line long enough to stop being a beat. Each of
 * those is asserted with the measurement that decided it, because a verdict
 * nobody can check is a verdict nobody can argue with.
 *
 * The one case that is not a number is the one that matters most: a costume that
 * is not in the authored file is refused however well it is made.
 */

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/**
 * A costume that is already known to be good, with one thing changed.
 *
 * Built by editing an authored entry rather than by writing a costume from
 * scratch, because a fixture that fails the allowlist would refuse everything
 * and prove nothing about the check under test.
 */
function variant(over: Partial<Persona> = {}): Persona {
  const base = authoredPersona('midwinter');
  if (!base) throw new Error('the authored set no longer has midwinter');
  return { ...base, ...over };
}

function findingsFor(persona: Persona): string[] {
  return validatePersona(persona).findings.map((finding) => finding.code);
}

/* ------------------------------------------------------------------ */
/* The authored set                                                    */
/* ------------------------------------------------------------------ */

describe('authored costumes', () => {
  for (const persona of AUTHORED_PERSONAS) {
    it(`${persona.id} passes its own checks`, () => {
      const verdict = validatePersona(persona);
      expect(verdict.findings).toEqual([]);
      expect(verdict.ok).toBe(true);
    });
  }

  it('reports the numbers it decided with, not just a verdict', () => {
    const verdict = validatePersona(variant());
    expect(verdict.caveat).toBe(PERSONA_CAVEAT);
    expect(verdict.digest.traitCount).toBe(3);
    expect(verdict.digest.shell).toBe('#25424e');
    expect(verdict.digest.minContrast).toBeGreaterThanOrEqual(MIN_TRAIT_CONTRAST);
    expect(verdict.digest.maxLineChars).toBeLessThanOrEqual(MAX_PERSONA_LINE_CHARS);
    expect(verdict.digest.maxDurationMs).toBe(240_000);
  });

  it('keeps every costume inside the limits the contract sets', () => {
    for (const persona of AUTHORED_PERSONAS) {
      expect(persona.traits.length).toBeLessThanOrEqual(MAX_PERSONA_TRAITS);
      expect(persona.bits.length).toBeGreaterThan(0);
      for (const bit of persona.bits) {
        expect(bit.lines.length).toBeGreaterThan(0);
        expect(bit.lines.length).toBeLessThanOrEqual(MAX_PERSONA_LINES_PER_BIT);
      }
      expect(persona.maxDurationMs).toBeGreaterThanOrEqual(MIN_PERSONA_DURATION_MS);
      expect(persona.maxDurationMs).toBeLessThanOrEqual(MAX_PERSONA_DURATION_MS);
    }
  });

  it('has no two costumes sharing an id', () => {
    const ids = AUTHORED_PERSONAS.map((persona) => persona.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/* ------------------------------------------------------------------ */
/* Who it is                                                           */
/* ------------------------------------------------------------------ */

describe('identity', () => {
  /*
   * The structural rule. A costume that reads as a specific real person is a
   * failure no colour arithmetic would catch, so it is prevented by making the
   * authored file the allowlist: a persona nobody wrote is a persona nobody
   * checked, and it cannot be worn however well it is drawn.
   */
  it('refuses a costume nobody wrote, however well it is made', () => {
    const invented = variant({ id: 'alderney', name: 'Alderney' });
    const verdict = validatePersona(invented);
    expect(verdict.ok).toBe(false);
    expect(verdict.findings.map((f) => f.code)).toContain('unknown-persona');
    expect(verdict.findings[0]?.path).toBe('id');
    expect(verdict.findings[0]?.measured.knownCount).toBe(AUTHORED_PERSONAS.length);
  });

  it('refuses a costume wearing a name that is not its own', () => {
    // Same id, different name: the name is part of the costume, so this is a
    // costume claiming to be someone else rather than a costume with a typo.
    expect(findingsFor(variant({ name: 'Nan' }))).toEqual(['renamed-persona']);
  });

  it('refuses an id that is not an address', () => {
    expect(findingsFor(variant({ id: 'Mid Winter' }))).toContain('malformed-id');
  });

  it('refuses a null costume without throwing', () => {
    const verdict = validatePersona(null as unknown as Persona);
    expect(verdict.ok).toBe(false);
    expect(verdict.findings.map((f) => f.code)).toEqual(['not-a-persona']);
    expect(verdict.digest.traitCount).toBe(0);
  });

  it('refuses an unreadable shell before it measures anything against it', () => {
    expect(findingsFor(variant({ shell: 'seafoam' }))).toContain('shell-colour-unreadable');
  });

  it('refuses an occasion that says nothing or says too much', () => {
    expect(findingsFor(variant({ occasion: '  ' }))).toEqual(['occasion-unusable']);
    expect(findingsFor(variant({ occasion: 'x'.repeat(241) }))).toEqual(['occasion-unusable']);
  });

  it('refuses a subject outside the four there are', () => {
    expect(findingsFor(variant({ subject: 'person' as never }))).toContain('unknown-subject');
  });
});

/* ------------------------------------------------------------------ */
/* How it is built                                                     */
/* ------------------------------------------------------------------ */

describe('ornaments', () => {
  it(`refuses a ${MAX_PERSONA_TRAITS + 1}th ornament`, () => {
    const traits = [
      { kind: 'hat' as const, color: '#d9615a', scale: 1 },
      { kind: 'beard' as const, color: '#efeae0', scale: 1 },
      { kind: 'scarf' as const, color: '#a9c9a0', scale: 1 },
      { kind: 'monocle' as const, color: '#e8c37a', scale: 0.9 },
      { kind: 'visor' as const, color: '#9fd0e8', scale: 0.9 },
    ];
    const verdict = validatePersona(variant({ traits }));
    expect(verdict.findings.map((f) => f.code)).toContain('too-many-traits');
    expect(verdict.digest.traitCount).toBe(5);
  });

  it('refuses an ornament that is not in the vocabulary', () => {
    const traits = [{ kind: 'snorkel' as PersonaTraitKind, color: '#e8c37a', scale: 1 }];
    expect(findingsFor(variant({ traits }))).toEqual(['unknown-trait-kind']);
  });

  it('refuses a scale outside the range the drawing is checked against', () => {
    const traits = [{ kind: 'hat' as const, color: '#d9615a', scale: 1.5 }];
    const verdict = validatePersona(variant({ traits }));
    expect(verdict.findings.map((f) => f.code)).toEqual(['trait-scale-out-of-range']);
    expect(verdict.findings[0]?.measured).toMatchObject({ min: 0.6, max: 1.4 });
  });

  it('refuses a nudge large enough to stop being a nudge', () => {
    const traits = [{ kind: 'hat' as const, color: '#d9615a', scale: 1, offset: { x: 0, y: 0.9 } }];
    expect(findingsFor(variant({ traits }))).toContain('trait-offset-too-large');
  });

  it('refuses an ornament with no readable colour', () => {
    const traits = [{ kind: 'hat' as const, color: 'cerulean', scale: 1 }];
    expect(findingsFor(variant({ traits }))).toEqual(['trait-colour-unreadable']);
  });

  /*
   * The threshold itself, from both sides. Ornaments are large shapes, so 2.5:1
   * is the floor and not the 4.5:1 a line of text would need; a colour that
   * lands just under it is refused, and one just over it is not.
   */
  it('refuses an ornament that cannot be told apart from the shell', () => {
    // A blue chosen to sit a whisker under the floor against midwinter's shell:
    // 2.44:1, which is close enough to 2.5 that only the arithmetic separates
    // them, and is refused all the same.
    const shell = hexToRgb('#25424e');
    expect(shell).not.toBeNull();
    const tooClose = '#4d8090';
    const rgb = hexToRgb(tooClose);
    expect(rgb).not.toBeNull();
    const ratio = contrastRatio(rgb!, shell!);
    expect(ratio).toBeLessThan(MIN_TRAIT_CONTRAST);
    expect(ratio).toBeGreaterThan(1);

    const traits = [{ kind: 'hat' as const, color: tooClose, scale: 1 }];
    const verdict = validatePersona(variant({ traits }));
    const finding = verdict.findings.find((f) => f.code === 'trait-contrast-too-low');
    expect(finding).toBeDefined();
    expect(finding?.measured.required).toBe(MIN_TRAIT_CONTRAST);
    expect(verdict.digest.minContrast).toBeCloseTo(ratio, 6);
  });

  it('accepts an ornament that only just clears the floor', () => {
    // The other side of the same boundary: 2.59:1. The floor is a floor, not a
    // target, and a costume that clears it by a hair is a costume that ships.
    const shell = hexToRgb('#25424e');
    const colour = '#528496';
    const rgb = hexToRgb(colour);
    expect(contrastRatio(rgb!, shell!)).toBeGreaterThanOrEqual(MIN_TRAIT_CONTRAST);
    const traits = [{ kind: 'hat' as const, color: colour, scale: 1 }];
    expect(findingsFor(variant({ traits }))).toEqual([]);
  });

  it('refuses two ornaments that occupy the same part of the shell', () => {
    // Hat and halo both claim the crown, and their sideways spans meet.
    const traits = [
      { kind: 'hat' as const, color: '#d9615a', scale: 1 },
      { kind: 'halo' as const, color: '#e8c37a', scale: 1 },
    ];
    const verdict = validatePersona(variant({ traits }));
    const finding = verdict.findings.find((f) => f.code === 'trait-collision');
    expect(finding).toBeDefined();
    expect(finding?.measured).toMatchObject({ first: 'hat', second: 'halo', region: 'crown' });
    expect(Number(finding?.measured.clearance)).toBeLessThan(0);
  });

  it('leaves ornaments alone when they claim different parts', () => {
    // A hat, a beard and a scarf: three regions, no argument.
    expect(
      findingsFor(
        variant({
          traits: [
            { kind: 'hat', color: '#d9615a', scale: 1 },
            { kind: 'beard', color: '#efeae0', scale: 1 },
            { kind: 'scarf', color: '#a9c9a0', scale: 1 },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('allows ornaments sharing the shell itself, which is drawn behind everything', () => {
    const traits = [
      { kind: 'spikes' as const, color: TRAIT_ROLES.creature.color, scale: 1 },
      { kind: 'crown' as const, color: '#e8c37a', scale: 1 },
    ];
    // Nothing was released by this pair and nothing was flagged: the two are not
    // compared at all, because the shell's own surface coexists with a crown.
    const verdict = validatePersona(variant({ traits }));
    const shellTrait = verdict.digest.traits[0];
    expect(shellTrait?.nearest).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* What it says                                                        */
/* ------------------------------------------------------------------ */

describe('bits', () => {
  it('refuses a line long enough to stop being a beat', () => {
    const long = 'x'.repeat(MAX_PERSONA_LINE_CHARS + 1);
    const bits = [{ id: 'long', mood: 'even' as const, lines: [long] }];
    const verdict = validatePersona(variant({ bits }));
    const finding = verdict.findings.find((f) => f.code === 'line-too-long');
    expect(finding?.path).toBe('bits[0].lines[0]');
    expect(finding?.measured).toMatchObject({ length: MAX_PERSONA_LINE_CHARS + 1, limit: MAX_PERSONA_LINE_CHARS });
  });

  it('refuses a blank line', () => {
    const bits = [{ id: 'blank', mood: 'even' as const, lines: ['Fine.', '   '] }];
    expect(findingsFor(variant({ bits }))).toEqual(['empty-line']);
  });

  it('refuses a bit with nothing to say', () => {
    const bits = [{ id: 'silent', mood: 'even' as const, lines: [] }];
    expect(findingsFor(variant({ bits }))).toEqual(['bit-without-lines']);
  });

  it(`refuses a ${MAX_PERSONA_LINES_PER_BIT + 1}th line`, () => {
    const bits = [{ id: 'rambling', mood: 'even' as const, lines: ['One.', 'Two.', 'Three.', 'Four.'] }];
    expect(findingsFor(variant({ bits }))).toContain('too-many-lines');
  });

  it('refuses two bits sharing an id, because a bit is asked for by name', () => {
    const bits = [
      { id: 'same', mood: 'even' as const, lines: ['One.'] },
      { id: 'same', mood: 'bright' as const, lines: ['Two.'] },
    ];
    expect(findingsFor(variant({ bits }))).toEqual(['duplicate-bit-id']);
  });

  it('refuses a mood the shell cannot hold', () => {
    const bits = [{ id: 'b', mood: 'smug' as never, lines: ['One.'] }];
    expect(findingsFor(variant({ bits }))).toEqual(['unknown-mood']);
  });
});

/* ------------------------------------------------------------------ */
/* How long it stays                                                   */
/* ------------------------------------------------------------------ */

describe('duration', () => {
  it('refuses a costume that would never come off', () => {
    const verdict = validatePersona(variant({ maxDurationMs: MAX_PERSONA_DURATION_MS + 1 }));
    expect(verdict.findings.map((f) => f.code)).toEqual(['duration-out-of-range']);
    expect(verdict.findings[0]?.measured).toMatchObject({ min: MIN_PERSONA_DURATION_MS, max: MAX_PERSONA_DURATION_MS });
  });

  it('refuses a costume too short to be seen', () => {
    expect(findingsFor(variant({ maxDurationMs: MIN_PERSONA_DURATION_MS - 1 }))).toEqual(['duration-out-of-range']);
  });

  it('accepts both ends of the range', () => {
    expect(findingsFor(variant({ maxDurationMs: MIN_PERSONA_DURATION_MS }))).toEqual([]);
    expect(findingsFor(variant({ maxDurationMs: MAX_PERSONA_DURATION_MS }))).toEqual([]);
  });

  it('refuses a duration that is not a number at all', () => {
    expect(findingsFor(variant({ maxDurationMs: undefined as unknown as number }))).toEqual(['duration-out-of-range']);
  });
});

/* ------------------------------------------------------------------ */
/* The slot the costume goes in                                        */
/* ------------------------------------------------------------------ */

/*
 * Expiry is the part of this feature with the worst failure mode: a costume
 * that never comes off stops being a joke and becomes the thing you are looking
 * at. It is settled by the clock and by nothing else, so it is tested that way.
 */
describe('PersonaSlot', () => {
  const costume = () => {
    const persona = authoredPersona('imp');
    if (!persona) throw new Error('the authored set no longer has imp');
    return persona;
  };

  it('takes its duration from the costume rather than from the caller', () => {
    const now = new Date('2026-09-10T12:00:00.000Z');
    const slot = new PersonaSlot();
    const wear = slot.wear(costume(), { reason: 'the fine print', now });
    expect(wear.expiresAt).toBe(new Date(now.getTime() + costume().maxDurationMs).toISOString());
    expect(wear.bitId).toBeNull();
    expect(slot.changed()).toBe(true);
  });

  it('comes back as nothing once its time is up', () => {
    const now = new Date('2026-09-10T12:00:00.000Z');
    const slot = new PersonaSlot();
    slot.wear(costume(), { reason: 'the fine print', now });

    const still = new Date(now.getTime() + costume().maxDurationMs - 1);
    expect(slot.current(still)?.persona.id).toBe('imp');
    // The client makes the same judgement locally; the host is the one that
    // decides, so the host must agree an expired costume is not a costume.
    expect(slot.current(new Date(now.getTime() + costume().maxDurationMs))).toBeNull();
  });

  it('carries an already-expired costume in from an earlier turn as nothing', () => {
    const slot = new PersonaSlot({
      persona: costume(),
      bitId: null,
      expiresAt: '2020-01-01T00:00:00.000Z',
      reason: 'long gone',
    });
    expect(slot.current()).toBeNull();
    // Nothing was touched, so nothing is written back: the store's own entry is
    // left to expire rather than being rewritten on every turn.
    expect(slot.changed()).toBe(false);
  });

  it('replaces a costume rather than stacking two', () => {
    const slot = new PersonaSlot();
    slot.wear(costume(), { reason: 'first' });
    slot.wear(costume(), { reason: 'second', bitId: 'for-the-record' });
    expect(slot.current()?.reason).toBe('second');
    expect(slot.current()?.bitId).toBe('for-the-record');
  });

  it('takes the costume off', () => {
    const slot = new PersonaSlot();
    slot.wear(costume(), { reason: 'on' });
    slot.clear();
    expect(slot.current()).toBeNull();
    expect(slot.changed()).toBe(true);
  });

  it('does not count taking off nothing as a change', () => {
    const slot = new PersonaSlot();
    slot.clear();
    expect(slot.changed()).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* The vocabulary the arithmetic runs on                               */
/* ------------------------------------------------------------------ */

describe('TRAIT_VOCABULARY', () => {
  it('places every ornament inside the region it claims', () => {
    for (const descriptor of Object.values(TRAIT_VOCABULARY)) {
      expect(regionContains(descriptor.region, descriptor.anchor)).toBe(true);
      expect(TRAIT_REGIONS[descriptor.region].where).toBeTruthy();
      expect(descriptor.note.length).toBeGreaterThan(0);
    }
  });

  /*
   * The claim the roles make: each register colour has already been checked
   * against every shell in the authored set. That claim is only worth making if
   * it is rechecked when either file changes, which is what this does.
   */
  it('gives every role a colour that reads against every authored shell', () => {
    for (const [role, descriptor] of Object.entries(TRAIT_ROLES) as [TraitRole, { color: string }][]) {
      const rgb = hexToRgb(normaliseColor(descriptor.color) ?? '');
      expect(rgb, `${role} is not a readable colour`).not.toBeNull();
      for (const persona of AUTHORED_PERSONAS) {
        const shell = hexToRgb(persona.shell);
        expect(shell, `${persona.id} has no readable shell`).not.toBeNull();
        const ratio = contrastRatio(rgb!, shell!);
        expect(ratio, `${role} on ${persona.id}`).toBeGreaterThanOrEqual(MIN_TRAIT_CONTRAST);
      }
    }
  });

  it('keeps a nudge allowance that still lets an ornament be worn', () => {
    // The attachment rule and the offset allowance have to be compatible: an
    // ornament nudged by the maximum must still reach the shell it sits on.
    expect(MAX_TRAIT_OFFSET).toBeGreaterThan(0);
    expect(MAX_TRAIT_OFFSET).toBeLessThan(1);
  });
});
