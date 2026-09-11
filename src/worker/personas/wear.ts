import type { Persona, PersonaWear } from '@shared/types';
import type { Env } from '../env';
import { authoredPersona } from './authored';

/**
 * The costume the shell is wearing, and how it comes off.
 *
 * A costume outlives the turn that put it on: the client applies the persona it
 * is sent and keeps it until something tells it otherwise, and the next turn
 * has to be able to say "still this one" rather than emptying the shell every
 * time anyone speaks. So the worn costume is stored between turns, and this
 * module owns both ends of that.
 *
 * What is stored is a *reference*, not the costume itself. The authored file is
 * the allowlist, and resolving through it on the way back in means a costume
 * that has been edited or removed since it went on cannot return from the dead
 * wearing its old clothes: the next turn either finds it in the file or takes
 * it off.
 *
 * Expiry is checked here rather than being left to the storage ttl, because
 * `expiresAt` is part of the contract with the client and a ttl is housekeeping.
 * A costume that has run out of time comes back as nothing, whatever the store
 * still holds.
 */

const KEY = (sessionId: string) => `persona:${sessionId}`;

/**
 * KV will not accept a ttl under a minute, and a costume may be ten seconds
 * long. The ttl is therefore the floor rather than the deadline: an entry may
 * outlive its costume by up to a minute, which costs nothing because every read
 * checks `expiresAt` itself.
 */
const MIN_TTL_SECONDS = 60;

/** What is actually written to the store. See the note about references above. */
interface StoredWear {
  personaId: string;
  bitId: string | null;
  expiresAt: string;
  reason: string;
}

export interface WearOptions {
  /** Why it went on, in the assistant's words. Required: the client shows it. */
  reason: string;
  /** The bit to play, if one was asked for. */
  bitId?: string | null;
  /** Injectable so a test can decide what time it is. */
  now?: Date;
}

/**
 * The costume channel for one turn.
 *
 * The same shape as the surface collector, for the same reason: a handler that
 * is handed one can say what it wants worn without knowing anything about the
 * session, the store, or the turn it is running inside. Only one costume can be
 * on at a time, so this is a slot rather than a list, and putting a second one
 * on replaces the first rather than stacking.
 */
export class PersonaSlot {
  private worn: PersonaWear | null;
  private touched = false;

  constructor(worn: PersonaWear | null = null) {
    this.worn = worn;
  }

  /**
   * Put a costume on.
   *
   * The duration comes from the costume rather than from the caller: how long a
   * persona may stay is a property of the persona, and a caller that could ask
   * for longer would make `maxDurationMs` decorative.
   */
  wear(persona: Persona, options: WearOptions): PersonaWear {
    const now = options.now ?? new Date();
    const wear: PersonaWear = {
      persona,
      bitId: options.bitId ?? null,
      expiresAt: new Date(now.getTime() + persona.maxDurationMs).toISOString(),
      reason: options.reason,
    };
    this.worn = wear;
    this.touched = true;
    return wear;
  }

  /** Take it off. */
  clear(): void {
    if (this.worn !== null) this.touched = true;
    this.worn = null;
  }

  /**
   * What is on now, or null.
   *
   * A costume whose time is up is not a costume any more, so it comes back as
   * nothing rather than as something already expired — the client would have to
   * make the same judgement, and only one of us should be making it.
   */
  current(now: Date = new Date()): PersonaWear | null {
    const worn = this.worn;
    if (worn === null) return null;
    return Date.parse(worn.expiresAt) > now.getTime() ? worn : null;
  }

  /** True when this turn changed what is worn, so the store needs to hear about it. */
  changed(): boolean {
    return this.touched;
  }
}

/**
 * The costume stored for this session, or null.
 *
 * An entry that has expired, cannot be parsed, or names a costume nobody wrote
 * any more is deleted on the way past: those are all conditions that will never
 * improve, and leaving them for the next turn to rediscover would be work done
 * once per turn forever.
 */
export async function loadPersona(
  env: Env,
  sessionId: string,
  now: Date = new Date(),
): Promise<PersonaWear | null> {
  const raw = await env.CACHE.get(KEY(sessionId));
  if (raw === null) return null;

  const stored = parseStored(raw);
  const persona = stored === null ? null : authoredPersona(stored.personaId);
  if (stored === null || persona === null || !(Date.parse(stored.expiresAt) > now.getTime())) {
    await env.CACHE.delete(KEY(sessionId));
    return null;
  }

  return { persona, bitId: stored.bitId, expiresAt: stored.expiresAt, reason: stored.reason };
}

/** Stores what is worn, or takes the entry out when nothing is. */
export async function storePersona(
  env: Env,
  sessionId: string,
  wear: PersonaWear | null,
): Promise<void> {
  if (wear === null) {
    await env.CACHE.delete(KEY(sessionId));
    return;
  }
  const stored: StoredWear = {
    personaId: wear.persona.id,
    bitId: wear.bitId,
    expiresAt: wear.expiresAt,
    reason: wear.reason,
  };
  const remaining = Math.ceil((Date.parse(wear.expiresAt) - Date.now()) / 1000);
  await env.CACHE.put(KEY(sessionId), JSON.stringify(stored), {
    expirationTtl: Math.max(MIN_TTL_SECONDS, remaining + MIN_TTL_SECONDS),
  });
}

function parseStored(raw: string): StoredWear | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.personaId !== 'string' || typeof record.expiresAt !== 'string') return null;
  return {
    personaId: record.personaId,
    bitId: typeof record.bitId === 'string' ? record.bitId : null,
    expiresAt: record.expiresAt,
    reason: typeof record.reason === 'string' ? record.reason : '',
  };
}
