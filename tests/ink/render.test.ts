import { describe, expect, it } from 'vitest';
import { renderReply, streamedRemainder } from '@worker/ink/render';
import { getStory, REPLY_SURFACE_ID } from '@worker/stories/registry';

/**
 * The reply surface is the one place host-supplied text becomes visible, so it
 * carries two promises. It must print what it was given, unaltered — the model
 * wrote that text and the personality layer approved it. And it must print it
 * first, because the client has already streamed it by the time the surface
 * runs, and text the user has read cannot be rewritten.
 */

const rendered = async (input: Parameters<typeof renderReply>[0]): Promise<string> => {
  const result = await renderReply(input);
  if (!result.ok) throw new Error(`render failed: ${result.message}`);
  return result.value;
};

/** Text that would be mangled by anything treating it as markup. */
const AWKWARD = [
  'A single plain sentence.',
  'First line.\nSecond line.\n\nThird after a blank.',
  'Braces {like this} and a pipe | and a hash #.',
  'Glue <> and a backslash \\ and a backtick `.',
  'Quotes "double" and \'single\' and an em dash — and an ellipsis…',
  'An expression that looks live: {reply} and a conditional: {closing: yes|no}',
];

describe('rendering a reply', () => {
  it('prints the reply verbatim', async () => {
    expect(await rendered({ text: 'I can help with the code.' })).toBe('I can help with the code.');
  });

  it.each(AWKWARD)('does not treat the reply as markup: %j', async (text) => {
    expect(await rendered({ text })).toBe(text);
  });

  it('renders nothing for an empty reply', async () => {
    expect(await rendered({ text: '' })).toBe('');
  });

  it('trims only the edges, which is what the client would draw anyway', async () => {
    expect(await rendered({ text: '   Padded.   ' })).toBe('Padded.');
  });
});

describe('prefix stability', () => {
  it.each(AWKWARD)('emits the reply before anything else: %j', async (text) => {
    expect((await rendered({ text })).startsWith(text)).toBe(true);
  });

  it('leaves nothing for a reply already streamed in full', async () => {
    const text = 'Two sentences. The second one adds detail.';
    expect(streamedRemainder(await rendered({ text }), text)).toBe('');
  });
});

describe('the closing beat', () => {
  it('answers with silence, whatever text was supplied', async () => {
    expect(await rendered({ text: 'Anything at all.', closing: true })).toBe('');
  });
});

describe('the surface itself', () => {
  it('is published and declares no external functions', () => {
    const story = getStory(REPLY_SURFACE_ID);
    expect(story).not.toBeNull();
    // Nothing here can dispatch anything, which is what lets the surface run
    // on every visible reply without an action gate in front of it.
    expect(story?.externals).toEqual([]);
  });

  it('enters at the render knot', () => {
    expect(getStory(REPLY_SURFACE_ID)?.entryKnot).toBe('render');
  });
});

describe('what is left to say', () => {
  it('sends the whole text when nothing has been shown', () => {
    expect(streamedRemainder('All of it.', '')).toBe('All of it.');
  });

  it('sends only the suffix when the prefix was shown', () => {
    expect(streamedRemainder('All of it, and more.', 'All of it,')).toBe(' and more.');
  });

  it('sends nothing when the shown text is not a prefix', () => {
    // Appending here would read as a continuation of something this is not a
    // continuation of, so the committed turn is left to correct the transcript.
    expect(streamedRemainder('A different reply.', 'What was streamed.')).toBe('');
  });

  it('sends nothing when the whole text was shown across several rounds', () => {
    expect(streamedRemainder('The reply.', 'The ' + 'reply.')).toBe('');
  });
});
