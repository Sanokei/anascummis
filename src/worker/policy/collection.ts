import type { Identity } from '@shared/types';
import type { Env } from '../env';

/**
 * What may be recorded about a person, and when.
 *
 * Three categories, and only one of them is optional:
 *
 *   necessary    Correctness records the product cannot work without. An
 *                action receipt is the clear case: it exists to stop a second
 *                dispatch of something that already happened, so it may block
 *                work even when memory is off. It records that a capability
 *                ran, never what was said.
 *
 *   content      Conversation text, transcripts, memories, page images. Stored
 *                only for an authenticated account that has switched on
 *                persistence. A guest's equivalents live in expiry-bound KV.
 *
 *   optional     Anything kept to understand usage rather than to serve the
 *                request. Off unless the person opts in, and switching it off
 *                stops the collection rather than merely hiding it.
 *
 * The rule this file exists to enforce: an optional record is not written at
 * all without consent. It is not written-then-filtered, and it is not written
 * in an anonymised form as a way around the refusal.
 */

export type CollectionCategory = 'necessary' | 'content' | 'optional';

export interface CollectionDecision {
  allowed: boolean;
  reason: string;
}

export interface CollectionContext {
  identity: Identity;
  /** True when the person opted in to optional collection. */
  optionalConsented: boolean;
  /** True when an authenticated account has durable memory switched on. */
  persistenceEnabled: boolean;
}

export function mayRecord(
  category: CollectionCategory,
  ctx: CollectionContext,
): CollectionDecision {
  switch (category) {
    case 'necessary':
      return {
        allowed: true,
        reason: 'Correctness records are required to avoid repeating a completed action.',
      };

    case 'content':
      if (ctx.identity.kind !== 'user') {
        return { allowed: false, reason: 'Guests have no durable content storage.' };
      }
      if (!ctx.persistenceEnabled) {
        return { allowed: false, reason: 'This account has durable memory switched off.' };
      }
      return { allowed: true, reason: 'The account has persistence switched on.' };

    case 'optional':
      return ctx.optionalConsented
        ? { allowed: true, reason: 'Optional collection was accepted.' }
        : { allowed: false, reason: 'Optional collection was not accepted.' };
  }
}

export async function collectionContext(env: Env, identity: Identity): Promise<CollectionContext> {
  const subject = identity.kind === 'user' ? `user:${identity.userId}` : `session:${identity.sessionId}`;

  const consent = await env.DB.prepare('SELECT analytics FROM consent_records WHERE subject_id = ?')
    .bind(subject)
    .first<{ analytics: number }>();

  const persistence =
    identity.kind === 'user'
      ? await env.DB.prepare('SELECT memory_enabled FROM users WHERE id = ?')
          .bind(identity.userId)
          .first<{ memory_enabled: number }>()
      : null;

  return {
    identity,
    optionalConsented: consent?.analytics === 1,
    persistenceEnabled: persistence?.memory_enabled === 1,
  };
}

/**
 * Strips request text from a record when content storage is not permitted.
 *
 * The record still says which skill ran and whether it worked, because that is
 * a necessary operational fact. What the person actually asked for is content
 * and is replaced rather than truncated, since a truncated request is still
 * the request.
 */
export function redactTaskText(text: string, ctx: CollectionContext): string {
  const decision = mayRecord('content', ctx);
  return decision.allowed ? text.slice(0, 400) : '[not stored]';
}

/**
 * What the interface and the privacy policy both read from.
 *
 * Keeping this in one place is what stops the policy drifting away from the
 * implementation: if a category is added here, both surfaces change with it.
 */
export const COLLECTION_DISCLOSURE = [
  {
    category: 'necessary' as const,
    label: 'Action records',
    stores: 'Which capability ran, when, whether it completed, and an idempotency key.',
    doesNotStore: 'What you said, or what the result contained.',
    why: 'To avoid running a consequential action twice and to report an unknown outcome honestly.',
    optOut: 'No. Without these the product cannot tell a repeat from a first attempt.',
    retention: 'Kept while the session exists, and with the account when signed in.',
  },
  {
    category: 'necessary' as const,
    label: 'Session and consent',
    stores: 'A session identifier, its expiry, a CSRF secret, and your cookie choice.',
    doesNotStore: 'Any profile built across sites, or anything used to identify you again later.',
    why: 'To keep you signed in, to block cross-site request forgery, and to remember your refusal.',
    optOut: 'No, but a guest session expires on its own and stores nothing about who you are.',
    retention: 'Guest sessions expire within 24 hours by default.',
  },
  {
    category: 'content' as const,
    label: 'Conversation and memory',
    stores: 'Turns, transcripts, saved memories, stored page images, and branch history.',
    doesNotStore: 'Anything at all, unless you are signed in with persistence switched on.',
    why: 'So a conversation can be resumed and an earlier decision can be revisited.',
    optOut: 'Yes. It is off by default, and deleting removes it.',
    retention: 'Until you delete it or delete the account.',
  },
  {
    category: 'optional' as const,
    label: 'Usage records',
    stores: 'Which skills ran and whether they succeeded, for understanding how the product is used.',
    doesNotStore: 'Your request text, unless conversation storage is separately switched on.',
    why: 'To see which procedures actually work. It is not needed to answer you.',
    optOut: 'Yes, and it is off until you accept. Refusing means the record is never written.',
    retention: 'Removed with the session or the account.',
  },
];

/** Audio is not retained by default, and no path here turns that into an option. */
export const AUDIO_DISCLOSURE = {
  stores: 'Nothing. Audio is sent to the transcription provider and the bytes are discarded.',
  transcripts:
    'The text transcript follows the conversation rules above: kept only for a signed-in account with persistence on.',
  note: 'There is no recording-retention setting, because no recording is retained.',
};
