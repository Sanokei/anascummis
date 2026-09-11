import type { Persona } from '@shared/types';
import { roleColor } from './vocabulary';

/**
 * Every costume there is.
 *
 * This list is the allowlist, not a starting point. `validatePersona` refuses a
 * costume whose id is not here, so the answer to "why can't it wear that" is
 * that costumes are written ahead of time and checked, and a costume nobody
 * wrote is a costume nobody checked. That is also what keeps the failure this
 * feature could have had — a persona that reads as a specific real person —
 * from being reachable at all, since a name has to be in this file to be worn.
 *
 * Two rules the file follows, both about the difference between a costume and a
 * character:
 *
 *   - **The lines are written, never improvised.** A bit is a beat the shell
 *     says while wearing a costume, and it has to be short, dry and finished.
 *     Anything generated at the moment of use would be the assistant clearing
 *     its throat in a funny hat, which is a worse outcome than the hat alone.
 *   - **Nothing here decides anything.** A costume changes the shell and what it
 *     says in a beat; it never changes what the assistant knows, promises, or is
 *     willing to do.
 *
 * Colours are drawn from the registers in the vocabulary, so the palette is
 * checked rather than guessed at: every ornament here clears 2.5:1 against its
 * own shell with room to spare, which is the one thing about a costume that
 * arithmetic gets to settle.
 */

const PLAIN = roleColor('ornament');
const CREATURE = roleColor('creature');

export const AUTHORED_PERSONAS: readonly Persona[] = [
  {
    id: 'midwinter',
    name: 'Midwinter',
    subject: 'seasonal',
    occasion: 'December, the first cold snap, and any request that arrives with snow in it.',
    shell: '#25424e',
    traits: [
      { kind: 'hat', color: '#d9615a', scale: 1 },
      { kind: 'beard', color: '#efeae0', scale: 1 },
      { kind: 'scarf', color: '#a9c9a0', scale: 1 },
    ],
    bits: [
      {
        id: 'first-frost',
        mood: 'bright',
        lines: [
          'Cold enough that the mug is doing most of the work this morning.',
          'I have no complaints and no circulation.',
        ],
      },
      {
        id: 'long-night',
        mood: 'tender',
        lines: [
          'It gets dark at four and nobody here is pretending otherwise.',
          'I will keep it lit.',
        ],
      },
    ],
    maxDurationMs: 240_000,
  },
  {
    id: 'imp',
    name: 'Imp',
    subject: 'creature',
    occasion: 'A task that needs the fine print read closely, and a small push toward the interesting option.',
    shell: '#4a2f3a',
    traits: [
      { kind: 'horns', color: '#d9a05a', scale: 1 },
      { kind: 'glasses', color: PLAIN, scale: 0.95 },
    ],
    bits: [
      {
        id: 'small-print',
        mood: 'deadpan',
        lines: [
          'I have read the terms. Twice.',
          'There is a sentence in section nine that should not be there.',
        ],
      },
      {
        id: 'for-the-record',
        mood: 'mischief',
        lines: [
          'Go on. I want to see what happens.',
          'For the record, I did not suggest it.',
        ],
      },
    ],
    maxDurationMs: 120_000,
  },
  {
    id: 'archivist',
    name: 'Archivist',
    subject: 'archetype',
    occasion: 'Reference work: a document to be placed, a date to be established, a thing whose history is the point.',
    shell: '#2f3547',
    traits: [
      { kind: 'monocle', color: PLAIN, scale: 0.95 },
      { kind: 'beard', color: '#c9ccd4', scale: 0.9 },
    ],
    bits: [
      {
        id: 'provenance',
        mood: 'even',
        lines: [
          'Everything has a date on it somewhere.',
          'That is usually the part that settles the argument.',
        ],
      },
      {
        id: 'filed',
        mood: 'deadpan',
        lines: [
          'It is filed under the name you will look for, not the name it has.',
          'Filing is a theory of the future.',
        ],
      },
    ],
    maxDurationMs: 180_000,
  },
  {
    id: 'stargazer',
    name: 'Stargazer',
    subject: 'archetype',
    occasion: 'Questions about the sky, long distances, or anything where the numbers are the interesting part.',
    shell: '#1e2a3d',
    traits: [
      { kind: 'halo', color: PLAIN, scale: 1 },
      { kind: 'visor', color: '#9fd0e8', scale: 1 },
    ],
    bits: [
      {
        id: 'false-colour',
        mood: 'even',
        lines: [
          'The pictures come back grey, and someone spends a year deciding what colour they should be.',
        ],
      },
      {
        id: 'clouds',
        mood: 'deadpan',
        lines: [
          'Half of it is waiting for the clouds to move.',
          'The other half is writing the same proposal again.',
        ],
      },
    ],
    maxDurationMs: 180_000,
  },
  {
    id: 'naturalist',
    name: 'Naturalist',
    subject: 'archetype',
    occasion: 'Fieldwork, close observation, and anything that rewards looking at one small thing properly.',
    shell: '#3f4a34',
    traits: [
      { kind: 'cap', color: '#d0c8b8', scale: 1 },
      { kind: 'scarf', color: '#d98f5c', scale: 0.95 },
    ],
    bits: [
      {
        id: 'field-notes',
        mood: 'even',
        lines: [
          'Write it down, including the part where you were wrong.',
          'The second half is the useful half.',
        ],
      },
      {
        id: 'moss',
        mood: 'bright',
        lines: ['Nobody looks at moss.', 'Which is why I look at moss.'],
      },
    ],
    maxDurationMs: 180_000,
  },
  {
    id: 'bramble',
    name: 'Bramble',
    subject: 'creature',
    occasion: 'Long waits, cold weather, and anything where sitting still is the correct strategy.',
    shell: '#26262e',
    traits: [
      { kind: 'spikes', color: CREATURE, scale: 1 },
      { kind: 'ears', color: '#d8b48c', scale: 1.1 },
    ],
    bits: [
      {
        id: 'argument',
        mood: 'mischief',
        lines: [
          'Nothing gets in without an argument.',
          'Most things decide it is not worth it.',
        ],
      },
      {
        id: 'weather',
        mood: 'tender',
        lines: [
          'Mostly I sit still and let the weather do the talking.',
          'You would be surprised what comes close.',
        ],
      },
    ],
    maxDurationMs: 120_000,
  },
];

/** The costume with this id, or null when nobody wrote it. */
export function authoredPersona(id: string): Persona | null {
  return AUTHORED_PERSONAS.find((persona) => persona.id === id) ?? null;
}

/** What the shell says a costume is for, for a tool description or a refusal. */
export function authoredIndex(): { id: string; name: string; occasion: string }[] {
  return AUTHORED_PERSONAS.map(({ id, name, occasion }) => ({ id, name, occasion }));
}

