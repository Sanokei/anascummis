import { fail, ok, type Result } from '@shared/types';
import { evaluate } from './runtime';
import { getStory, REPLY_SURFACE_ID } from '../stories/registry';

/**
 * The render point for every visible reply.
 *
 * One authored, precompiled story renders host-supplied text, rather than a
 * story compiled per turn. Compilation is the expensive half of Ink, and a
 * per-turn compile put it on the critical path of a turn whose whole point was
 * to feel immediate — to print a string the host already had.
 *
 * The contract is prefix-stability: the surface emits the reply verbatim, and
 * it emits it first. Anything the surface adds comes after, because the host
 * streams the reply to the client as the model produces it, and text the user
 * has already read cannot be rewritten. `streamedRemainder` is that contract
 * applied — it is what stops a rendered reply from being shown twice.
 */

export interface ReplyRenderInput {
  text: string;
  /** True for the turn that answers the host's closing line. */
  closing?: boolean;
}

export async function renderReply(input: ReplyRenderInput): Promise<Result<string>> {
  const story = getStory(REPLY_SURFACE_ID);
  if (!story) return fail('missing-capability', 'The reply surface is not published.');

  const evaluation = await evaluate({
    compiled: story.compiled,
    stateJson: null,
    entryKnot: story.entryKnot,
    memo: new Map(),
    readableConfig: {},
    inputs: { reply: input.text, closing: input.closing ?? false },
    riskFor: () => 'none',
  });

  return evaluation.ok ? ok(evaluation.value.text) : evaluation;
}

/**
 * What is left to say once `shown` has already been streamed.
 *
 * The reply surface guarantees the rendered text begins with the reply, so the
 * remainder is a plain suffix. Where that does not hold — a surface change, or
 * a stream that was assembled from more than the final reply — the honest
 * answer is to add nothing and let the committed turn correct the transcript,
 * rather than to append text that reads as a continuation of something else.
 */
export function streamedRemainder(rendered: string, shown: string): string {
  if (!shown) return rendered;
  return rendered.startsWith(shown) ? rendered.slice(shown.length) : '';
}
