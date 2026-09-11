import { useEffect, useState } from 'react';
/*
 * The verdict vocabulary is imported from the module that defines it, exactly
 * as `DesignView` does: the two components have to agree about what
 * `deterministic` means, and a second copy of those words would be free to
 * drift from the first. These are type-only imports, so the compiler erases
 * them and no Worker code reaches the client bundle.
 */
import type { CheckRefusal, DesignReview, Surface } from '../../worker/design/types';
import { DesignView, type DesignIssue, type DesignVerdict } from './DesignView';

/**
 * A design block, mounted.
 *
 * The block that reaches the client carries two ids and a caption and nothing
 * else, because a window outlives the turn that raised it: a review copied into
 * the block while the turn ran would sit in a window that is still on screen
 * and quietly stop being what was recorded. The ids are fetched here instead,
 * from the route that owns them and under the same session bound as every other
 * read, so what is drawn is the review that was actually recorded — or the
 * route's refusal to hand one over, and never a stale copy of either.
 *
 * This module is a mount point and nothing more. It settles which of three
 * states it is in and hands the result to `DesignView`, which draws what a
 * verdict is worth; that judgement is `DesignView`'s subject and not this
 * file's, and nothing here re-forms or softens it.
 */

export interface DesignBlockProps {
  /** Both, or the block names no revision and there is nothing to load. */
  labId?: string;
  revisionId?: string;
  caption?: string;
}

export function DesignBlock({ labId, revisionId, caption }: DesignBlockProps) {
  /*
   * Half an address is not an address. A request built from one of the two ids
   * would be a request for a revision that cannot exist, and its 404 would read
   * as a failure of work nobody asked for. What the author wrote under the
   * block is the whole of what it has to show; with no caption there is still
   * one sentence saying so rather than a hole.
   */
  if (!labId || !revisionId) {
    return (
      <p className="text-ink-faint text-[0.82rem]">
        {caption ?? 'This block names no revision, so there is nothing to show.'}
      </p>
    );
  }

  /*
   * Keyed by the pair rather than left to the effect. A block whose ids are
   * revised under it would otherwise render one frame of the previous
   * revision's result under the new revision's name, on the way to the effect
   * that replaces it.
   */
  return <RevisionView key={`${labId}/${revisionId}`} labId={labId} revisionId={revisionId} />;
}

/* ------------------------------------------------------------------ */
/* The three states                                                    */
/* ------------------------------------------------------------------ */

function RevisionView({ labId, revisionId }: { labId: string; revisionId: string }) {
  const state = useRevision(revisionUrl(labId, revisionId));

  if (state.status === 'loading') {
    return <p className="text-ink-faint font-mono text-[0.72rem]">Fetching the revision</p>;
  }

  if (state.status === 'failed') {
    /*
     * The route's sentence, printed as it was written. A friendlier one
     * composed here would be this component's words about a refusal it did not
     * make, and a 404 says only that the revision is not in this session: a
     * revision that never existed and one belonging to somebody else are
     * deliberately the same answer, so nothing here guesses which it was.
     */
    return <p className="text-caution text-[0.82rem]">{state.message}</p>;
  }

  /*
   * Already flat and already named as the props are named, so it is handed over
   * whole. Written out field by field it would be a second copy of the route's
   * contract, free to fall out of step with it without anything failing.
   */
  return <DesignView {...state.result} />;
}

/* ------------------------------------------------------------------ */
/* The wire                                                            */
/* ------------------------------------------------------------------ */

/**
 * One revision's recorded result, as the design route returns it.
 *
 * Every key here maps onto a field of `DesignViewProps`, which is what makes
 * the wiring above a spread. `availability` is the one prop the route does not
 * send and this component does not ask for: what this deployment is able to
 * render is a question for `/api/session`, not for a window about a picture
 * that has already been made.
 */
interface DesignResult {
  labId: string;
  revisionId: string;
  title: string;
  surface: Surface;
  round: number;
  maxRounds: number;
  verdicts: DesignVerdict[];
  allVerified: boolean;
  counts: DesignReview['counts'];
  otherObservations: string[];
  refused: CheckRefusal[];
  reviewedBy: string | null;
  /** When the revision was recorded, which is when it was reviewed. Not drawn. */
  reviewedAt: string;
  caveat: string;
  issues: DesignIssue[];
  renderKeys: Record<string, string>;
  glbKey: string | null;
}

type RevisionState =
  | { status: 'loading' }
  | { status: 'ready'; result: DesignResult }
  | { status: 'failed'; message: string };

/**
 * Fetches one revision and holds it for as long as the block is on screen.
 *
 * Shaped after `DesignView`'s `useStoredBytes`, for the same reason: a block
 * can be closed, replaced or scrolled out of the layer while a request is in
 * the air, and a state update after that is a render of something that is no
 * longer there. The flag and the abort both exist because one does not cover
 * the other — an abort is asynchronous, so the flag is what is checked before
 * anything is set, and the abort is what stops the request being carried to the
 * end of its round trip.
 */
function useRevision(url: string): RevisionState {
  const [state, setState] = useState<RevisionState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    setState({ status: 'loading' });

    void (async () => {
      try {
        const res = await fetch(url, { credentials: 'same-origin', signal: controller.signal });
        if (!live) return;

        if (!res.ok) {
          setState({ status: 'failed', message: await failureMessage(res) });
          return;
        }

        const result = (await res.json()) as DesignResult;
        if (!live) return;
        setState({ status: 'ready', result });
      } catch (err) {
        // An abort is this effect being replaced by the next one, not a fault.
        if (!live) return;
        setState({
          status: 'failed',
          message: err instanceof Error ? err.message : 'That revision could not be read.',
        });
      }
    })();

    return () => {
      live = false;
      controller.abort();
    };
  }, [url]);

  return state;
}

/**
 * The route's own words about a refusal.
 *
 * Every route in this Worker fails as `{ error, message }` under a non-2xx
 * status, and the message is the sentence written for a person to read. It is
 * shown rather than replaced, so the only case that needs a sentence from here
 * is a response with no readable body — where nothing was said to pass on.
 */
async function failureMessage(res: Response): Promise<string> {
  try {
    const detail = (await res.json()) as { message?: unknown };
    if (typeof detail.message === 'string' && detail.message !== '') return detail.message;
  } catch {
    /* Not JSON, so the status is all there is to report. */
  }
  return `The design route answered ${res.status}.`;
}

/**
 * The route that rebuilds a revision's recorded result from its two ids.
 *
 * Each id is one path segment and is encoded as one, so an id carrying a slash
 * cannot become two segments: the route checks both against its own patterns,
 * and an id it would refuse has to arrive intact for it to be able to refuse
 * it.
 */
function revisionUrl(labId: string, revisionId: string): string {
  return `/api/design/${encodeURIComponent(labId)}/revisions/${encodeURIComponent(revisionId)}`;
}
