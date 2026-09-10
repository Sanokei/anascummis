import type {
  ConsentState,
  GlobalConfig,
  JobView,
  PendingConfirmation,
  Turn,
  TurnResponse,
} from '@shared/types';

/**
 * Typed client for the Worker API.
 *
 * Every failure reaches the interface as a named kind, because a missing
 * credential, a denied permission and an exhausted budget are different things
 * and the user is told which one happened.
 */

export interface ApiError {
  kind: string;
  message: string;
  outcomeUnknown: boolean;
  status: number;
}

export class ApiFailure extends Error {
  constructor(readonly detail: ApiError) {
    super(detail.message);
    this.name = 'ApiFailure';
  }
}

export interface SessionState {
  identity:
    | { kind: 'guest'; sessionId: string }
    | { kind: 'user'; sessionId: string; email: string | null; displayName: string | null };
  csrfToken: string;
  config: GlobalConfig;
  memoryEnabled: boolean;
  turns: Turn[];
  jobs: JobView[];
  pendingConfirmation: PendingConfirmation | null;
  generation: number;
  listening: boolean;
  providers: { name: string; displayName: string }[];
  capabilities: {
    model: { provider: string; model: string; reason: string };
    speech: { provider: string; model: string };
    vision: { provider: string; model: string; reason: string };
    cloudflareConnect: boolean;
  };
  consent: ConsentState;
  policyVersion: string;
}

let csrf = '';

export function setCsrf(token: string): void {
  csrf = token;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.method && init.method !== 'GET') {
    headers.set('x-anascummis-csrf', csrf);
    if (!(init.body instanceof FormData)) headers.set('content-type', 'application/json');
  }

  const res = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  const text = await res.text();
  const parsed: unknown = text ? safeJson(text) : null;

  if (!res.ok) {
    const detail = (parsed ?? {}) as { error?: string; message?: string; outcomeUnknown?: boolean };
    throw new ApiFailure({
      kind: detail.error ?? 'unknown',
      message: detail.message ?? `Request failed with ${res.status}.`,
      outcomeUnknown: detail.outcomeUnknown ?? false,
      status: res.status,
    });
  }
  return parsed as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const api = {
  async session(): Promise<SessionState> {
    const state = await request<SessionState>('/api/session');
    setCsrf(state.csrfToken);
    return state;
  },

  turn(input: {
    text: string;
    rawTranscript?: string;
    choiceIndex?: number;
    confirmationToken?: string;
    signal?: AbortSignal;
  }): Promise<TurnResponse> {
    const { signal, ...body } = input;
    return request<TurnResponse>('/api/turn', {
      method: 'POST',
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  },

  stop(): Promise<{ stopped: boolean; generation: number; note: string }> {
    return request('/api/stop', { method: 'POST', body: '{}' });
  },

  setListening(listening: boolean): Promise<{ listening: boolean }> {
    return request('/api/listening', { method: 'POST', body: JSON.stringify({ listening }) });
  },

  transcribe(form: FormData): Promise<{
    suppressed: boolean;
    reason?: string;
    text: string;
    rawTranscript?: string;
    provider?: string;
    confidence?: number | null;
  }> {
    return request('/api/transcribe', { method: 'POST', body: form });
  },

  uploadImage(form: FormData): Promise<{ attachmentId: string; note: string }> {
    return request('/api/attachments', { method: 'POST', body: form });
  },

  saveSettings(patch: unknown): Promise<{ config: GlobalConfig }> {
    return request('/api/settings', { method: 'POST', body: JSON.stringify(patch) });
  },

  setMemoryPersistence(enabled: boolean): Promise<{ enabled: boolean }> {
    return request('/api/memory/persistence', { method: 'POST', body: JSON.stringify({ enabled }) });
  },

  exportMemory(): Promise<unknown> {
    return request('/api/memory/export');
  },

  deleteMemory(): Promise<{ removed: number; note: string }> {
    return request('/api/memory/delete', { method: 'POST', body: '{}' });
  },

  saveConsent(analytics: boolean): Promise<{ consent: ConsentState }> {
    return request('/api/consent', { method: 'POST', body: JSON.stringify({ analytics }) });
  },

  capabilities(): Promise<{
    capabilities: {
      id: string;
      version: string;
      title: string;
      summary: string;
      kind: string;
      risk: string;
      permissions: string[];
      requiresConfirmation: boolean;
      status: string;
    }[];
    storiesRequire: string[];
  }> {
    return request('/api/capabilities');
  },

  skills(): Promise<{
    skills: {
      qualifiedName: string;
      revision: string;
      origin: string;
      title: string;
      description: string;
      license: string;
      invocation: string;
      trust: string;
      toolPermissions: string[];
    }[];
    recentRuns: {
      id: string;
      skillName: string;
      skillVersion: string;
      outcome: string;
      reason?: string;
      at: string;
    }[];
  }> {
    return request('/api/skills');
  },

  stories(): Promise<{
    stories: { id: string; version: string; entryKnot: string; externals: string[] }[];
  }> {
    return request('/api/stories');
  },

  receipts(): Promise<{
    receipts: {
      id: string;
      capability_id: string;
      capability_version: string;
      outcome: string;
      intent_at: string;
      outcome_at: string | null;
      summary: string;
    }[];
  }> {
    return request('/api/receipts');
  },

  branches(): Promise<{
    branches: {
      id: string;
      label: string | null;
      summary: string | null;
      branchState: string;
      createdAt: string;
    }[];
  }> {
    return request('/api/branches');
  },

  visionPages(query: string): Promise<{
    retrievalMode: string;
    generationIsVisual: boolean;
    pages: { id: string; documentId: string; pageNumber: number; origin: string; descriptor: string }[];
  }> {
    return request(`/api/vision/pages?q=${encodeURIComponent(query)}`);
  },

  logout(): Promise<{ signedOut: boolean }> {
    return request('/auth/logout', { method: 'POST', body: '{}' });
  },
};
