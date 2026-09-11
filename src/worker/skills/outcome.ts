import type { SkillRunRecord } from '@shared/types';

/**
 * What a run record should say, given what actually happened.
 *
 * The obvious rule — if a dispatch failed, mark the run failed — is wrong, and
 * wrong in the direction that costs the most. A capability that times out and a
 * model that recovers from it is a run that worked. Recording it as a failure
 * teaches every later reader that the failure column is noise, which is exactly
 * how a real failure gets ignored.
 *
 * So this does not grade. It reports two things it can actually witness: whether
 * the turn produced an answer at all, and which dispatches did not come back as
 * a value. Ranking runs is somebody else's job, and whoever does it can change
 * their mind without the record having to be collected again.
 */
export interface RunObservations {
  /** The turn produced a reply the user could read. */
  replied: boolean;
  /** Dispatches that came back as anything other than a value, in order. */
  failures: readonly string[];
  /** Dispatches that stopped and asked the user to confirm first. */
  confirmations: readonly string[];
}

/**
 * A run that produced no reply did not finish, whatever else is true of it.
 * Everything else is a note attached to that verdict, not a revision of it.
 */
export function describeRun(
  observed: RunObservations,
): Pick<SkillRunRecord, 'outcome'> & { reason?: string } {
  const notes = [
    ...observed.failures.map((failure) => `dispatch failed: ${failure}`),
    ...observed.confirmations.map((confirmation) => `awaiting confirmation: ${confirmation}`),
  ];

  return {
    outcome: observed.replied ? 'completed' : 'failed',
    // Left absent rather than empty when there is nothing to say, so a reader
    // can tell "nothing went wrong" apart from "nobody wrote it down".
    ...(notes.length > 0 ? { reason: notes.join('; ') } : {}),
  };
}
