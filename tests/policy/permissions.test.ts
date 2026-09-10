import { describe, expect, it } from 'vitest';
import type { CapabilityContract, PermissionName, RiskClass } from '@shared/types';
import {
  PermissionEnvelope,
  RISK_ORDER,
  confirmationBinding,
  defaultEnvelope,
  needsConfirmation,
} from '@worker/policy/permissions';

/**
 * Two rules live here. An envelope only ever shrinks as it is passed inward,
 * and a confirmation is bound to the exact thing the user agreed to, so a
 * changed argument, version or permission set invalidates the approval rather
 * than carrying it over to something else.
 */

const contract = (overrides: Partial<CapabilityContract> = {}): CapabilityContract => ({
  id: 'cloudflare.deploy',
  version: '1.0.0',
  sourceHash: 'hash',
  kind: 'native',
  title: 'Deploy',
  summary: 'Deploys the worker.',
  owner: 'host',
  workspaceScope: 'global',
  input: { type: 'object' },
  output: { type: 'object' },
  permissions: ['cloudflare.deploy'],
  risk: 'irreversible',
  requiresConfirmation: false,
  budget: { timeoutMs: 10_000, instructionLimit: 0, outputBytes: 1024, hostCalls: 1 },
  idempotent: false,
  cancellable: true,
  validation: { validatedAt: '2026-09-10T00:00:00.000Z', validator: 'test', checks: [], passed: true },
  status: 'installed',
  installedAt: '2026-09-10T00:00:00.000Z',
  ...overrides,
});

const binding = (overrides: Record<string, unknown> = {}) =>
  confirmationBinding({
    capabilityId: 'cloudflare.deploy',
    capabilityVersion: '1.0.0',
    args: { target: 'anascummis.com' },
    sessionId: 'session_1',
    generation: 1,
    permissions: ['cloudflare.deploy', 'net.fetch'],
    ...overrides,
  } as Parameters<typeof confirmationBinding>[0]);

describe('the envelope', () => {
  it('holds what it was given, sorted', () => {
    const envelope = new PermissionEnvelope(['workspace.read', 'clock.read', 'net.fetch']);
    expect(envelope.list()).toEqual(['clock.read', 'net.fetch', 'workspace.read']);
  });

  it('keeps one copy of a permission granted twice', () => {
    expect(new PermissionEnvelope(['net.fetch', 'net.fetch']).list()).toEqual(['net.fetch']);
  });

  it('narrows to the intersection', () => {
    const envelope = new PermissionEnvelope(['net.fetch', 'workspace.read', 'memory.write']);
    expect(envelope.narrowTo(['workspace.read', 'memory.write']).list()).toEqual([
      'memory.write',
      'workspace.read',
    ]);
  });

  it('cannot be widened by asking for something it never held', () => {
    const envelope = new PermissionEnvelope(['net.fetch']);
    expect(envelope.narrowTo(['cloudflare.deploy', 'memory.write']).list()).toEqual([]);
  });

  it('cannot be widened by asking for everything', () => {
    const envelope = new PermissionEnvelope(['clock.read']);
    const everything: PermissionName[] = [
      'net.search',
      'net.fetch',
      'workspace.read',
      'workspace.write',
      'skills.read',
      'skills.execute',
      'memory.read',
      'memory.write',
      'cloudflare.read',
      'cloudflare.deploy',
      'clock.read',
    ];
    expect(envelope.narrowTo(everything).list()).toEqual(['clock.read']);
  });

  it('leaves the envelope it was narrowed from untouched', () => {
    const envelope = new PermissionEnvelope(['net.fetch', 'workspace.read']);
    const narrowed = envelope.narrowTo(['net.fetch']);
    narrowed.grant('cloudflare.deploy');

    expect(envelope.list()).toEqual(['net.fetch', 'workspace.read']);
    expect(envelope.has('cloudflare.deploy')).toBe(false);
  });

  it('stays narrow through repeated narrowing', () => {
    let envelope = new PermissionEnvelope(['net.fetch', 'workspace.read', 'clock.read']);
    for (let i = 0; i < 4; i++) envelope = envelope.narrowTo(['net.fetch', 'cloudflare.deploy']);
    expect(envelope.list()).toEqual(['net.fetch']);
  });

  it('lists what a contract is missing rather than only that something is', () => {
    const envelope = new PermissionEnvelope(['net.fetch']);
    const needy = contract({ permissions: ['net.fetch', 'cloudflare.deploy', 'memory.write'] });

    expect(envelope.missingFor(needy)).toEqual(['cloudflare.deploy', 'memory.write']);

    const checked = envelope.check(needy);
    expect(checked.ok).toBe(false);
    if (!checked.ok) {
      expect(checked.kind).toBe('missing-permission');
      expect(checked.message).toContain('cloudflare.deploy');
      expect(checked.detail).toEqual({ missing: ['cloudflare.deploy', 'memory.write'] });
    }
  });

  it('passes a contract whose permissions are all held', () => {
    const envelope = new PermissionEnvelope(['net.fetch', 'workspace.read']);
    expect(envelope.check(contract({ permissions: ['net.fetch'] })).ok).toBe(true);
    expect(envelope.check(contract({ permissions: [] })).ok).toBe(true);
  });
});

describe('the baseline grants', () => {
  it('gives a guest no reach into durable memory', () => {
    const envelope = defaultEnvelope({ kind: 'guest', sessionId: 's1' });
    expect(envelope.has('memory.read')).toBe(false);
    expect(envelope.has('memory.write')).toBe(false);
  });

  it('gives an account memory but still not deployment', () => {
    const envelope = defaultEnvelope({
      kind: 'user',
      sessionId: 's1',
      userId: 'u1',
      email: null,
      displayName: null,
    });
    expect(envelope.has('memory.read')).toBe(true);
    expect(envelope.has('memory.write')).toBe(true);
    expect(envelope.has('cloudflare.deploy')).toBe(false);
    expect(envelope.has('cloudflare.read')).toBe(false);
  });
});

describe('deciding whether to confirm', () => {
  const modes = ['always', 'risky-only', 'off'] as const;

  it('confirms irreversible work whatever the preference says', () => {
    for (const mode of modes) {
      expect(needsConfirmation(contract({ risk: 'irreversible' }), mode), mode).toBe(true);
    }
  });

  it('confirms high-risk work whatever the preference says', () => {
    for (const mode of modes) {
      expect(needsConfirmation(contract({ risk: 'high' }), mode), mode).toBe(true);
    }
  });

  it('never confirms a risk-free reader when confirmation is set to always', () => {
    expect(needsConfirmation(contract({ risk: 'none' }), 'always')).toBe(false);
  });

  it('confirms anything above risk-free when set to always', () => {
    for (const risk of ['low', 'moderate'] as const) {
      expect(needsConfirmation(contract({ risk }), 'always'), risk).toBe(true);
    }
  });

  it('confirms only moderate and above when set to risky-only', () => {
    expect(needsConfirmation(contract({ risk: 'low' }), 'risky-only')).toBe(false);
    expect(needsConfirmation(contract({ risk: 'moderate' }), 'risky-only')).toBe(true);
  });

  it('skips confirmation for low and moderate work when switched off', () => {
    for (const risk of ['none', 'low', 'moderate'] as const) {
      expect(needsConfirmation(contract({ risk }), 'off'), risk).toBe(false);
    }
  });

  it('honours a contract that asks to confirm, unless confirmation is switched off', () => {
    const asks = contract({ risk: 'low', requiresConfirmation: true });
    expect(needsConfirmation(asks, 'always')).toBe(true);
    expect(needsConfirmation(asks, 'risky-only')).toBe(true);
    expect(needsConfirmation(asks, 'off')).toBe(false);
  });

  it('orders the risk classes so moderate is the dividing line', () => {
    expect(RISK_ORDER.none).toBeLessThan(RISK_ORDER.low);
    expect(RISK_ORDER.low).toBeLessThan(RISK_ORDER.moderate);
    expect(RISK_ORDER.moderate).toBeLessThan(RISK_ORDER.high);
    expect(RISK_ORDER.high).toBeLessThan(RISK_ORDER.irreversible);
  });
});

describe('what a confirmation is bound to', () => {
  it('is stable for the same action', async () => {
    expect(await binding()).toBe(await binding());
  });

  it('does not depend on the order the arguments were written in', async () => {
    const first = await binding({ args: { target: 'anascummis.com', force: true } });
    const second = await binding({ args: { force: true, target: 'anascummis.com' } });
    expect(first).toBe(second);
  });

  it('does not depend on the order the permissions were listed in', async () => {
    const first = await binding({ permissions: ['net.fetch', 'cloudflare.deploy'] });
    const second = await binding({ permissions: ['cloudflare.deploy', 'net.fetch'] });
    expect(first).toBe(second);
  });

  it('changes when the argument changes, so approving one target does not approve another', async () => {
    const approved = await binding({ args: { target: 'anascummis.com' } });
    const substituted = await binding({ args: { target: 'someone-elses-domain.com' } });
    expect(substituted).not.toBe(approved);
  });

  it('changes when a new argument is added to the same call', async () => {
    const plain = await binding({ args: { target: 'anascummis.com' } });
    const withExtra = await binding({ args: { target: 'anascummis.com', force: true } });
    expect(withExtra).not.toBe(plain);
  });

  it('changes when the capability version moves', async () => {
    expect(await binding({ capabilityVersion: '1.0.1' })).not.toBe(await binding());
  });

  it('changes when a different capability is named', async () => {
    expect(await binding({ capabilityId: 'cloudflare.read' })).not.toBe(await binding());
  });

  it('changes when the session changes', async () => {
    expect(await binding({ sessionId: 'session_2' })).not.toBe(await binding());
  });

  it('changes after Stop, because the generation moved', async () => {
    expect(await binding({ generation: 2 })).not.toBe(await binding());
  });

  it('changes when the permission set changes', async () => {
    const narrower = await binding({ permissions: ['cloudflare.deploy'] });
    const wider = await binding({ permissions: ['cloudflare.deploy', 'net.fetch', 'memory.write'] });
    expect(narrower).not.toBe(await binding());
    expect(wider).not.toBe(await binding());
  });

  it('is a sha-256 digest rather than anything reversible', async () => {
    expect(await binding()).toMatch(/^[0-9a-f]{64}$/);
  });
});
