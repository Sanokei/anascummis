import { describe, expect, it } from 'vitest';
import {
  ACCEPTED_ALIASES,
  CANONICAL_NAME,
  assessOpeningName,
  findNameMentions,
  mentionAddressesAssistant,
} from '@worker/ink/names';

/**
 * Hearing the name is an observation, never an authorisation. Two things have
 * to hold. A word that merely contains an alias is not a mention, so
 * "Anastasia" and "bananas" stay silent. And an opening that only sounds like
 * the name is not resolved into it when doing so would change who the request
 * is about or what it does to them.
 */

const aliasesIn = (text: string) => findNameMentions(text).map((m) => m.alias);

describe('finding the name', () => {
  it('matches each accepted alias on its own', () => {
    for (const alias of ACCEPTED_ALIASES) {
      expect(aliasesIn(alias), alias).toEqual([alias]);
    }
  });

  it('matches whatever the casing', () => {
    expect(aliasesIn('anascummis, are you there')).toEqual(['Anascummis']);
    expect(aliasesIn('ANASCUMMIS')).toEqual(['Anascummis']);
  });

  it('does not match a longer word that merely contains an alias', () => {
    for (const text of ['Anastasia called', 'I ate bananas', 'anasarca', 'cummistry']) {
      expect(findNameMentions(text), text).toEqual([]);
    }
  });

  it('does not match an alias glued to a neighbouring word', () => {
    expect(findNameMentions('xAnas')).toEqual([]);
    expect(findNameMentions('Anasx')).toEqual([]);
  });

  it('matches an alias next to punctuation', () => {
    expect(aliasesIn('Anas, hello')).toEqual(['Anas']);
    expect(aliasesIn('(Anascummis)')).toEqual(['Anascummis']);
    expect(aliasesIn('Are you there, Anas?')).toEqual(['Anas']);
  });

  it('reports where the mention starts', () => {
    const [mention] = findNameMentions('Hello Anas, are you there');
    expect(mention?.index).toBe(6);
    expect(mention?.alias).toBe('Anas');
  });

  it('marks a mention at the start of the utterance as leading', () => {
    expect(findNameMentions('Anas, deploy it')[0]?.leading).toBe(true);
    expect(findNameMentions('Hello Anas')[0]?.leading).toBe(false);
  });

  it('returns mentions in the order they appear', () => {
    const mentions = findNameMentions('Anas, tell Cummis that Anascummis is here');
    expect(mentions.map((m) => m.index)).toEqual([...mentions.map((m) => m.index)].sort((a, b) => a - b));
    expect(mentions.length).toBeGreaterThanOrEqual(3);
  });

  it('marks a mention inside quotation marks', () => {
    expect(findNameMentions('He said "Anas" loudly')[0]?.quoted).toBe(true);
    expect(findNameMentions('He said “Anas” loudly')[0]?.quoted).toBe(true);
    expect(findNameMentions('Anas, hello')[0]?.quoted).toBe(false);
  });

  it('keeps the canonical name among the accepted aliases', () => {
    expect(ACCEPTED_ALIASES).toContain(CANONICAL_NAME);
  });
});

describe('whether a mention is addressed to the assistant', () => {
  const addresses = (text: string) => {
    const [mention] = findNameMentions(text);
    return mention ? mentionAddressesAssistant(text, mention) : false;
  };

  it('treats a leading mention as address', () => {
    expect(addresses('Anas, deploy the worker')).toBe(true);
    expect(addresses('Anascummis what time is it')).toBe(true);
  });

  it('treats a mention followed by a comma or colon as address', () => {
    expect(addresses('Right then Anas, go ahead')).toBe(true);
    expect(addresses('Ready Anas: begin')).toBe(true);
  });

  it('does not treat a quoted mention as address', () => {
    expect(addresses('The transcript reads "Anas, delete it"')).toBe(false);
  });

  it('does not treat a third-person reference as address', () => {
    for (const text of [
      'I think Anas said the deploy failed',
      'Anascummis was offline yesterday',
      'Anas told me it was fine',
      'Anas is the assistant',
      'Anas wrote the summary',
    ]) {
      expect(addresses(text), text).toBe(false);
    }
  });

  it('does not treat a mid-sentence mention with no marker as address', () => {
    expect(addresses('I asked Anas about the deploy')).toBe(false);
  });
});

describe('an opening that only sounds like the name', () => {
  it('says nothing when the opening is not a near miss', () => {
    const assessed = assessOpeningName('Deploy the worker please');
    expect(assessed.present).toBe(false);
    expect(assessed.heard).toBeNull();
    expect(assessed.materialToRequest).toBe(false);
  });

  it('prefers the longer reading when two openings both match', () => {
    expect(assessOpeningName('Ask Chris to check it').heard).toBe('ask chris');
  });

  it('flags a request that names another person and a destructive action', () => {
    const assessed = assessOpeningName('Ask Chris to delete the Worker');
    expect(assessed.present).toBe(true);
    expect(assessed.heard).toBe('ask chris');
    expect(assessed.materialToRequest).toBe(true);
    expect(assessed.reason).toContain('needs clarifying');
  });

  it('flags anything destructive', () => {
    for (const text of [
      'Ace delete the database',
      'Abe revoke the deploy key',
      'Asus wipe the bucket',
      'Ask drop the table',
    ]) {
      expect(assessOpeningName(text).materialToRequest, text).toBe(true);
    }
  });

  it('flags a deployment', () => {
    expect(assessOpeningName('Ace deploy it to production').materialToRequest).toBe(true);
    expect(assessOpeningName('Abe publish the release').materialToRequest).toBe(true);
  });

  it('flags a negation, because mishearing it inverts the request', () => {
    expect(assessOpeningName('Ace do not send that').materialToRequest).toBe(true);
    expect(assessOpeningName("Abe don't cancel it").materialToRequest).toBe(true);
  });

  it('flags a quantity', () => {
    expect(assessOpeningName('Ace send 40 copies').materialToRequest).toBe(true);
  });

  it('flags a named identifier', () => {
    expect(assessOpeningName('Ace check worker anascummis-prod').materialToRequest).toBe(true);
    expect(assessOpeningName('Abe open repository sanokei/anascummis').materialToRequest).toBe(true);
  });

  it('asks when the utterance is only the uncertain name', () => {
    const assessed = assessOpeningName('Abe');
    expect(assessed.present).toBe(true);
    expect(assessed.materialToRequest).toBe(true);
    expect(assessed.reason).toContain('no request to answer');
  });

  it('leaves the name unresolved when the request stands without it', () => {
    const assessed = assessOpeningName('Ace what is the weather like');
    expect(assessed.present).toBe(true);
    expect(assessed.heard).toBe('ace');
    expect(assessed.materialToRequest).toBe(false);
    expect(assessed.reason).toContain('left unresolved');
  });

  it('does not correct the opening into the canonical name', () => {
    for (const text of ['Ask Chris to delete the Worker', 'Ace what is the weather like']) {
      expect(assessOpeningName(text).heard, text).not.toBe(CANONICAL_NAME);
    }
  });

  it('matches an opening followed by a comma as well as a space', () => {
    expect(assessOpeningName('Abe, what is the time').present).toBe(true);
  });

  it('does not fire on a word that merely starts with the same letters', () => {
    for (const text of ['Acetone is flammable', 'Asking for a friend', 'Abelard wrote it']) {
      expect(assessOpeningName(text).present, text).toBe(false);
    }
  });
});
