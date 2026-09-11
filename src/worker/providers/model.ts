import { fail, ok, type Result } from '@shared/types';
import type { Env } from '../env';

/**
 * Conversational model adapter.
 *
 * The wire model identifier is configuration, never a guess. `resolveRoute`
 * reports exactly which provider and model identifier a call will use, and an
 * absent provider produces `missing-credential` rather than a silent
 * substitution or a stale scaffold default.
 */

export type ModelClass = 'flash' | 'pro';

/**
 * DeepSeek's reasoning-effort vocabulary, read off the provider rather than
 * inferred from documentation.
 *
 * Verified 2026-09-11 by sending a deliberately invalid value and reading the
 * validation error, which enumerated the real set. It is wider than the four
 * levels this code previously assumed, and `medium` is a real level — the old
 * mapping silently downgraded it to `low`.
 */
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ReasoningFields {
  thinking: { type: 'disabled' | 'adaptive' | 'enabled' };
  reasoning_effort?: ReasoningEffort;
}

/**
 * How much reasoning a turn is allowed to spend.
 *
 * Off is the default, and it is expressed by asking for nothing, because the
 * provider's own default is thinking *on*: an unasked-for reply was spending
 * seconds producing reasoning before its first visible word. Nothing in the
 * codebase could say "off" before this — which is why every turn paid for it.
 *
 * `none` is not off. It still enables thinking and still emits reasoning, just
 * briefly, so the two stay distinct rather than being folded into one value.
 *
 * `adaptive` hands the choice to the provider. It is accepted because it
 * exists and it is what "let it decide for itself" would mean, but it is not
 * the default: one probe run showed it reasoning on a trivial question, which
 * is not the wanted behaviour, and that run was too degraded to settle it.
 */
export function reasoningFields(requested?: ReasoningEffort | 'adaptive'): ReasoningFields {
  if (requested === undefined) return { thinking: { type: 'disabled' } };
  if (requested === 'adaptive') return { thinking: { type: 'adaptive' } };
  return { thinking: { type: 'enabled' }, reasoning_effort: requested };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Set on a tool result so the provider can pair it with its call. */
  toolCallId?: string;
  name?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: unknown;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  modelClass?: ModelClass;
  temperature?: number;
  maxTokens?: number;
  /**
   * How much reasoning this turn may spend.
   *
   * Absent means none at all, which is the common case: a turn has to ask for
   * thinking rather than get it by default. See `reasoningFields` for why.
   */
  requestedEffort?: ReasoningEffort | 'adaptive';
  /** Requests a JSON object response where the provider supports it. */
  json?: boolean;
  /** Streams text deltas to this callback as they arrive (DeepSeek only). */
  onText?: (delta: string) => void;
  signal?: AbortSignal;
}

export interface ChatResult {
  text: string;
  toolCalls: ToolCall[];
  provider: 'deepseek' | 'workers-ai';
  model: string;
  usage: { promptTokens: number; completionTokens: number };
  /** True when the provider stopped because it hit the token ceiling. */
  truncated: boolean;
}

export interface ModelRoute {
  provider: 'deepseek' | 'workers-ai' | 'none';
  model: string;
  reason: string;
  supportsTools: boolean;
}

export function resolveRoute(env: Env, cls: ModelClass = 'flash'): ModelRoute {
  if (env.DEEPSEEK_API_KEY && env.DEEPSEEK_BASE_URL) {
    const model = cls === 'pro' ? env.DEEPSEEK_MODEL_PRO : env.DEEPSEEK_MODEL;
    if (model) {
      return {
        provider: 'deepseek',
        model,
        reason: 'DEEPSEEK_API_KEY is configured.',
        supportsTools: true,
      };
    }
  }
  if (env.AI && env.WORKERS_AI_CHAT_MODEL) {
    return {
      provider: 'workers-ai',
      model: env.WORKERS_AI_CHAT_MODEL,
      reason: 'No DeepSeek key is configured; using the bound Workers AI model.',
      supportsTools: true,
    };
  }
  return {
    provider: 'none',
    model: '',
    reason: 'No conversational model provider is configured.',
    supportsTools: false,
  };
}

export async function chat(env: Env, req: ChatRequest): Promise<Result<ChatResult>> {
  const route = resolveRoute(env, req.modelClass ?? 'flash');
  if (route.provider === 'none') {
    return fail(
      'missing-credential',
      'No conversational model is available. Set DEEPSEEK_API_KEY or bind Workers AI.',
    );
  }
  if (route.provider === 'deepseek') return deepseekChat(env, route, req);
  return workersAiChat(env, route, req);
}

/**
 * Streams a conversational reply.
 *
 * DeepSeek streams over SSE and forwards text deltas through `req.onText` as
 * they arrive, which is what makes a spoken reply read as immediate rather
 * than arriving whole at the end of the turn. Workers AI has no streaming
 * surface, so it degrades to a single-shot call that emits the reply once.
 */
export async function streamChat(env: Env, req: ChatRequest): Promise<Result<ChatResult>> {
  const route = resolveRoute(env, req.modelClass ?? 'flash');
  if (route.provider === 'none') {
    return fail(
      'missing-credential',
      'No conversational model is available. Set DEEPSEEK_API_KEY or bind Workers AI.',
    );
  }
  if (route.provider === 'deepseek') return deepseekStreamChat(env, route, req);

  const res = await workersAiChat(env, route, req);
  if (res.ok && res.value.text) req.onText?.(res.value.text);
  return res;
}

async function deepseekChat(env: Env, route: ModelRoute, req: ChatRequest): Promise<Result<ChatResult>> {
  const body = buildDeepseekBody(route, req, false);

  try {
    const res = await fetch(`${env.DEEPSEEK_BASE_URL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: req.signal,
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 400);
      return fail('upstream-error', `Model provider returned ${res.status}.`, detail);
    }
    const parsed = (await res.json()) as OpenAiCompletion;
    const choice = parsed.choices?.[0];
    return ok({
      text: choice?.message?.content ?? '',
      toolCalls: readToolCalls(choice?.message?.tool_calls),
      provider: 'deepseek',
      model: route.model,
      usage: {
        promptTokens: parsed.usage?.prompt_tokens ?? 0,
        completionTokens: parsed.usage?.completion_tokens ?? 0,
      },
      truncated: choice?.finish_reason === 'length',
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return fail('cancelled', 'Model call was cancelled.');
    }
    return fail('upstream-error', `Model call failed: ${String(err)}`);
  }
}

/**
 * Shared request body. Streaming and buffered calls differ only in `stream`
 * (and the resulting transport), not in the prompt, tools or effort.
 */
function buildDeepseekBody(route: ModelRoute, req: ChatRequest, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: route.model,
    messages: req.messages.map(toOpenAiMessage),
    temperature: req.temperature ?? 0.6,
    max_tokens: req.maxTokens ?? 1200,
    stream,
    ...reasoningFields(req.requestedEffort),
  };
  if (req.tools?.length) {
    body.tools = req.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
    body.tool_choice = 'auto';
  }
  if (req.json) body.response_format = { type: 'json_object' };
  return body;
}

async function deepseekStreamChat(env: Env, route: ModelRoute, req: ChatRequest): Promise<Result<ChatResult>> {
  let res: Response;
  try {
    res = await fetch(`${env.DEEPSEEK_BASE_URL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(buildDeepseekBody(route, req, true)),
      signal: req.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return fail('cancelled', 'Model call was cancelled.');
    }
    return fail('upstream-error', `Model call failed: ${String(err)}`);
  }

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 400);
    return fail('upstream-error', `Model provider returned ${res.status}.`, detail);
  }

  const reader = res.body?.getReader();
  if (!reader) return deepseekChat(env, route, req);

  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let finishReason = '';
  const toolFragments = new Map<number, { id: string; name: string; arguments: string }>();

  const consume = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') return;

    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    if (!json || typeof json !== 'object') return;
    const record = json as Record<string, unknown>;

    const choices = record.choices as Array<Record<string, unknown>> | undefined;
    const choice = choices?.[0];
    if (!choice || typeof choice !== 'object') return;

    const delta = (choice.delta ?? {}) as Record<string, unknown>;
    if (typeof delta.content === 'string' && delta.content) {
      text += delta.content;
      req.onText?.(delta.content);
    }

    const toolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(toolCalls)) {
      for (const call of toolCalls) {
        const index = typeof call.index === 'number' ? call.index : 0;
        let fragment = toolFragments.get(index);
        if (!fragment) {
          fragment = { id: '', name: '', arguments: '' };
          toolFragments.set(index, fragment);
        }
        if (typeof call.id === 'string') fragment.id = call.id;
        const fn = call.function as Record<string, unknown> | undefined;
        if (fn && typeof fn.name === 'string') fragment.name = fn.name;
        if (fn && typeof fn.arguments === 'string') fragment.arguments += fn.arguments;
      }
    }

    if (typeof choice.finish_reason === 'string') finishReason = choice.finish_reason;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        consume(buffer.slice(0, newline).replace(/\r$/, ''));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) consume(buffer);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return fail('cancelled', 'Model call was cancelled.');
    }
    return fail('upstream-error', `Model stream failed: ${String(err)}`);
  }

  const toolCalls: ToolCall[] = [...toolFragments.values()]
    .filter((fragment) => fragment.name)
    .map((fragment) => ({
      id: fragment.id || `call_${fragment.name}`,
      name: fragment.name,
      arguments: normaliseArgs(fragment.arguments),
    }));

  return ok({
    text,
    toolCalls,
    provider: 'deepseek',
    model: route.model,
    // Streaming does not report usage, so the budget charge is estimated.
    usage: {
      promptTokens: estimateTokens(req.messages.map((m) => m.content).join('\n')),
      completionTokens: estimateTokens(text),
    },
    truncated: finishReason === 'length',
  });
}

async function workersAiChat(env: Env, route: ModelRoute, req: ChatRequest): Promise<Result<ChatResult>> {
  if (!env.AI) return fail('missing-credential', 'Workers AI is not bound.');
  const payload: Record<string, unknown> = {
    messages: req.messages.map(toOpenAiMessage),
    max_tokens: req.maxTokens ?? 1200,
    temperature: req.temperature ?? 0.6,
  };
  if (req.tools?.length) {
    payload.tools = req.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }
  try {
    const raw = (await env.AI.run(route.model as never, payload as never)) as WorkersAiResponse;
    const toolCalls = (raw.tool_calls ?? []).map((c, i) => ({
      id: `wai_${i}`,
      name: c.name,
      arguments: normaliseArgs(c.arguments),
    }));
    return ok({
      text: typeof raw.response === 'string' ? raw.response : '',
      toolCalls,
      provider: 'workers-ai',
      model: route.model,
      usage: {
        promptTokens: raw.usage?.prompt_tokens ?? 0,
        completionTokens: raw.usage?.completion_tokens ?? 0,
      },
      truncated: false,
    });
  } catch (err) {
    return fail('upstream-error', `Workers AI call failed: ${String(err)}`);
  }
}

interface WorkersAiResponse {
  response?: string;
  tool_calls?: { name: string; arguments?: unknown }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface OpenAiCompletion {
  choices?: {
    finish_reason?: string;
    message?: {
      content?: string;
      tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
    };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function toOpenAiMessage(m: ChatMessage): Record<string, unknown> {
  if (m.role === 'tool') {
    return { role: 'tool', content: m.content, tool_call_id: m.toolCallId ?? '', name: m.name };
  }
  return { role: m.role, content: m.content };
}

function readToolCalls(raw: OpenAiCompletion['choices'] extends undefined ? never : unknown): ToolCall[] {
  if (!Array.isArray(raw)) return [];
  const out: ToolCall[] = [];
  for (const entry of raw as { id?: string; function?: { name?: string; arguments?: string } }[]) {
    const name = entry.function?.name;
    if (!name) continue;
    out.push({
      id: entry.id ?? `call_${out.length}`,
      name,
      arguments: normaliseArgs(entry.function?.arguments),
    });
  }
  return out;
}

/** Tool arguments arrive as a JSON string from some providers and an object from others. */
export function normaliseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Rough token estimate for budget accounting before a provider reports usage. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
