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
  /** Requests a JSON object response where the provider supports it. */
  json?: boolean;
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

async function deepseekChat(env: Env, route: ModelRoute, req: ChatRequest): Promise<Result<ChatResult>> {
  const body: Record<string, unknown> = {
    model: route.model,
    messages: req.messages.map(toOpenAiMessage),
    temperature: req.temperature ?? 0.6,
    max_tokens: req.maxTokens ?? 1200,
    stream: false,
  };
  if (req.tools?.length) {
    body.tools = req.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
    body.tool_choice = 'auto';
  }
  if (req.json) body.response_format = { type: 'json_object' };

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
