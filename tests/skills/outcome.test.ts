import { describe, expect, it } from 'vitest';
import { describeRun } from '@worker/skills/outcome';

/**
 * A run record is the only account of a turn that outlives the turn. Sessions
 * are capped and reset; the DO forgets. So whatever this decides is what any
 * later reader — a person, or a process looking for patterns across runs — has
 * to reason from, and it has to be true before it is tidy.
 */

const clean = { replied: true, failures: [], confirmations: [] };

describe('what a run record says', () => {
  it('calls a clean run completed', () => {
    expect(describeRun(clean)).toEqual({ outcome: 'completed' });
  });

  it('calls a run with no reply failed', () => {
    expect(describeRun({ ...clean, replied: false }).outcome).toBe('failed');
  });

  it('leaves the reason absent rather than empty when nothing went wrong', () => {
    // A reader has to be able to tell "nothing went wrong" apart from "nobody
    // wrote anything down". An empty string collapses those two into one.
    expect(describeRun(clean)).not.toHaveProperty('reason');
  });
});

describe('a run that recovered', () => {
  it('is still completed, and still says what went wrong', () => {
    // The case the old derivation got wrong in the quiet direction. The model
    // recovered, so the turn worked; the dispatch that failed is still a fact
    // about the run and is reported alongside it.
    const record = describeRun({
      replied: true,
      failures: ['web.fetch (timeout)'],
      confirmations: [],
    });
    expect(record.outcome).toBe('completed');
    expect(record.reason).toBe('dispatch failed: web.fetch (timeout)');
  });

  it('does not mark a recovered run as failed just because something failed', () => {
    // Grading here would train a reader to distrust the failure column, which
    // costs more than the tidier record is worth.
    expect(describeRun({ replied: true, failures: ['a', 'b'], confirmations: [] }).outcome).toBe(
      'completed',
    );
  });
});

describe('what gets written down', () => {
  it('keeps every failure, in the order they happened', () => {
    const record = describeRun({
      replied: true,
      failures: ['web.fetch (timeout)', 'fs.write (denied)', 'net.dns (unknown)'],
      confirmations: [],
    });
    expect(record.reason).toBe(
      'dispatch failed: web.fetch (timeout); dispatch failed: fs.write (denied); dispatch failed: net.dns (unknown)',
    );
  });

  it('distinguishes a call that stopped for confirmation from one that failed', () => {
    // These are not the same event and must not read as one: a failure is
    // something to fix, a confirmation is the system working as designed.
    const record = describeRun({
      replied: true,
      failures: [],
      confirmations: ['mail.send'],
    });
    expect(record.reason).toBe('awaiting confirmation: mail.send');
    expect(record.reason).not.toContain('failed');
  });

  it('reports both when a run did both', () => {
    const record = describeRun({
      replied: false,
      failures: ['web.fetch (timeout)'],
      confirmations: ['mail.send'],
    });
    expect(record).toEqual({
      outcome: 'failed',
      reason: 'dispatch failed: web.fetch (timeout); awaiting confirmation: mail.send',
    });
  });
});
