import { afterEach, describe, expect, it, vi } from 'vitest';
import { chat, reasoningFields, type ReasoningEffort } from '@worker/providers/model';
import type { Env } from '@worker/env';

/**
 * Reasoning is off unless a turn asks for it.
 *
 * The provider's own default is thinking *on*, which is the expensive half of
 * a reply and the half nobody sees: measured against the live provider, an
 * ordinary question spent 6.8 seconds producing reasoning before its first
 * visible word. So the default here is deliberately the opposite of the
 * provider's, and these tests exist to keep it that way — a silent regression
 * to the provider default would not fail anything else in this suite.
 *
 * The vocabulary is the provider's, read off a validation error rather than
 * taken from documentation. It is wider than this code once assumed, and the
 * level it used to downgrade is covered below.
 */

const LEVELS: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

describe('how much a turn may think', () => {
  it('is off when nothing was asked for', () => {
    expect(reasoningFields()).toEqual({ thinking: { type: 'disabled' } });
  });

  it('carries no effort level when thinking is off', () => {
    // `none` is a real effort level and a different thing from off, so an
    // absent request must not be quietly expressed as one of the levels.
    expect(reasoningFields()).not.toHaveProperty('reasoning_effort');
  });

  it('hands the choice to the provider when asked to adapt', () => {
    expect(reasoningFields('adaptive')).toEqual({ thinking: { type: 'adaptive' } });
  });

  it.each(LEVELS)('enables thinking and passes %s through unchanged', (level) => {
    expect(reasoningFields(level)).toEqual({
      thinking: { type: 'enabled' },
      reasoning_effort: level,
    });
  });

  it('does not downgrade medium', () => {
    // The old mapping claimed the provider's set was none/low/high/max and
    // rewrote medium to low. Both halves were wrong: medium is accepted, and
    // the set has seven values. This is the regression that cost a level.
    expect(reasoningFields('medium').reasoning_effort).toBe('medium');
  });
});

/**
 * The fields above are only worth anything if they reach the wire. `chat` is
 * driven through a stubbed transport so the assertion is made against the
 * request body the provider would actually receive, not against the helper.
 */
describe('the request the provider receives', () => {
  const captured: { body?: Record<string, unknown> } = {};

  const env = {
    DEEPSEEK_API_KEY: 'test-key',
    DEEPSEEK_BASE_URL: 'https://provider.test/v1',
    DEEPSEEK_MODEL: 'deepseek-flash',
  } as unknown as Env;

  const reply = (): Response =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );

  afterEach(() => {
    vi.unstubAllGlobals();
    delete captured.body;
  });

  const send = async (requestedEffort?: ReasoningEffort | 'adaptive'): Promise<Record<string, unknown>> => {
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured.body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return reply();
    });
    const result = await chat(env, {
      messages: [{ role: 'user', content: 'What is a lighthouse for?' }],
      ...(requestedEffort ? { requestedEffort } : {}),
    });
    expect(result.ok).toBe(true);
    return captured.body ?? {};
  };

  it('tells the provider not to think when no turn asked it to', async () => {
    const body = await send();
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body).not.toHaveProperty('reasoning_effort');
  });

  it('sends the requested level when a turn asked to think', async () => {
    const body = await send('high');
    expect(body.thinking).toEqual({ type: 'enabled' });
    expect(body.reasoning_effort).toBe('high');
  });

  it('sends adaptive as adaptive rather than as a level', async () => {
    const body = await send('adaptive');
    expect(body.thinking).toEqual({ type: 'adaptive' });
    expect(body).not.toHaveProperty('reasoning_effort');
  });
});
