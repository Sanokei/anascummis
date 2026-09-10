/**
 * Cross-cutting contracts shared by the Worker and the browser client.
 * Anything the client is allowed to see lives here; secrets never do.
 */

export type Identity =
  | { kind: 'guest'; sessionId: string }
  | {
      kind: 'user';
      sessionId: string;
      userId: string;
      email: string | null;
      displayName: string | null;
    };

export type ConfirmationMode = 'always' | 'risky-only' | 'off';

export type RiskClass = 'none' | 'low' | 'moderate' | 'high' | 'irreversible';

/** Distinct failure conditions. The spec requires these not be collapsed into one "error". */
export type FailureKind =
  | 'missing-capability'
  | 'missing-credential'
  | 'missing-permission'
  | 'missing-skill'
  | 'unsupported-runtime'
  | 'contract-mismatch'
  | 'revoked'
  | 'budget-exhausted'
  | 'timeout'
  | 'cancelled'
  | 'sandbox-violation'
  | 'invalid-argument'
  | 'upstream-error'
  | 'not-authorised'
  | 'unknown';

export interface StructuredFailure {
  ok: false;
  kind: FailureKind;
  message: string;
  detail?: unknown;
  /** True when the operation may have taken effect remotely and needs reconciliation. */
  outcomeUnknown?: boolean;
}

export interface StructuredSuccess<T> {
  ok: true;
  value: T;
}

export type Result<T> = StructuredSuccess<T> | StructuredFailure;

export const ok = <T>(value: T): StructuredSuccess<T> => ({ ok: true, value });

export const fail = (
  kind: FailureKind,
  message: string,
  detail?: unknown,
  outcomeUnknown?: boolean,
): StructuredFailure => ({ ok: false, kind, message, detail, outcomeUnknown });

/* ------------------------------------------------------------------ */
/* Capability registry                                                 */
/* ------------------------------------------------------------------ */

export type PermissionName =
  | 'net.search'
  | 'net.fetch'
  | 'workspace.read'
  | 'workspace.write'
  | 'skills.read'
  | 'skills.execute'
  | 'memory.read'
  | 'memory.write'
  | 'cloudflare.read'
  | 'cloudflare.deploy'
  | 'clock.read';

export const ALL_PERMISSIONS: PermissionName[] = [
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

export interface CapabilityBudget {
  /** Wall-clock ceiling for one invocation. */
  timeoutMs: number;
  /** Lua VM instruction ceiling; ignored by native host adapters. */
  instructionLimit: number;
  /** Serialized output ceiling in bytes. */
  outputBytes: number;
  /** How many granted host bindings one invocation may call. */
  hostCalls: number;
}

export interface ValidationCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface ValidationEvidence {
  validatedAt: string;
  validator: string;
  checks: ValidationCheck[];
  passed: boolean;
}

export type JsonSchema = {
  type: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'null';
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: (string | number)[];
  description?: string;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  additionalProperties?: boolean;
};

export interface CapabilityContract {
  /** Stable, human-readable id such as web.search. Never constructed at runtime. */
  id: string;
  version: string;
  /** sha-256 of the executable source, hex. Immutable per version. */
  sourceHash: string;
  kind: 'native' | 'lua';
  title: string;
  summary: string;
  owner: string;
  workspaceScope: 'global' | 'user' | 'session';
  input: JsonSchema;
  output: JsonSchema;
  permissions: PermissionName[];
  risk: RiskClass;
  requiresConfirmation: boolean;
  budget: CapabilityBudget;
  idempotent: boolean;
  cancellable: boolean;
  validation: ValidationEvidence;
  status: 'installed' | 'draft' | 'revoked';
  installedAt: string;
}

/* ------------------------------------------------------------------ */
/* Conversation                                                        */
/* ------------------------------------------------------------------ */

export type TurnRole = 'user' | 'assistant' | 'system';

export interface Turn {
  id: string;
  role: TurnRole;
  text: string;
  at: string;
  /** Raw transcript kept separate from interpreted meaning. */
  rawTranscript?: string;
  transcriptConfidence?: number;
  /** Set when the assistant reused an authored personality line verbatim. */
  authoredLineId?: string;
}

export interface InkChoiceView {
  index: number;
  text: string;
  /** Host-classified risk of the action this choice would dispatch, if any. */
  risk: RiskClass;
  capabilityId?: string;
}

export interface PendingConfirmation {
  id: string;
  capabilityId: string;
  capabilityVersion: string;
  title: string;
  action: string;
  target: string;
  consequences: string[];
  risk: RiskClass;
  /** Binds the confirmation to exact action and arguments; changing either invalidates it. */
  bindingHash: string;
  expiresAt: string;
}

export interface ActionReceipt {
  id: string;
  capabilityId: string;
  capabilityVersion: string;
  idempotencyKey: string;
  intentRecordedAt: string;
  observedOutcome: 'completed' | 'failed' | 'cancelled' | 'unknown' | 'pending';
  outcomeRecordedAt: string | null;
  summary: string;
}

export interface JobView {
  id: string;
  kind: string;
  label: string;
  state: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  speculative: boolean;
  startedAt: string;
  finishedAt: string | null;
  detail?: string;
}

export interface SkillRunRecord {
  id: string;
  skillName: string;
  skillVersion: string;
  skillOrigin: string;
  task: string;
  capabilityVersions: string[];
  permissions: PermissionName[];
  outcome: 'completed' | 'failed' | 'blocked' | 'no-skill-needed';
  reason?: string;
  at: string;
}

export interface Citation {
  title: string;
  url: string;
  snippet: string;
  retrievedAt: string;
}

export interface BudgetView {
  dispatchesUsed: number;
  dispatchesMax: number;
  hostCallsUsed: number;
  hostCallsMax: number;
  elapsedMs: number;
  elapsedMaxMs: number;
  forgeAttemptsUsed: number;
  forgeAttemptsMax: number;
  exhausted: boolean;
}

export interface TurnResponse {
  sessionId: string;
  turns: Turn[];
  choices: InkChoiceView[];
  pendingConfirmation: PendingConfirmation | null;
  citations: Citation[];
  jobs: JobView[];
  activeSkill: { name: string; version: string; origin: string } | null;
  checkpointId: string;
  budget: BudgetView;
  /** Populated when the turn stopped early. */
  blocked: { kind: FailureKind; message: string } | null;
  /** Set when the host paused because a budget ran out. */
  paused: boolean;
  mission: string | null;
  currentTask: string | null;
  currentFocus: string | null;
}

/* ------------------------------------------------------------------ */
/* Global configuration                                                */
/* ------------------------------------------------------------------ */

export interface GlobalConfig {
  schemaVersion: 2;
  dialogue: {
    confirmationMode: ConfirmationMode;
    language: string;
    speechOutput: boolean;
    speechRate: number;
    allowInterruption: boolean;
  };
  accessibility: {
    captions: boolean;
    textScale: number;
    highContrast: boolean;
    reducedMotion: boolean;
    screenReaderVerbose: boolean;
  };
  memory: {
    /** Durable memory requires an authenticated identity; guests cannot enable it. */
    persistenceEnabled: boolean;
  };
  project: Record<string, string>;
}

export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  schemaVersion: 2,
  dialogue: {
    confirmationMode: 'always',
    language: 'en',
    speechOutput: true,
    speechRate: 1,
    allowInterruption: true,
  },
  accessibility: {
    captions: true,
    textScale: 1,
    highContrast: false,
    reducedMotion: false,
    screenReaderVerbose: false,
  },
  memory: { persistenceEnabled: false },
  project: {},
};

/** Keys Ink is allowed to read. Anything absent is invisible to generated stories. */
export const INK_READABLE_CONFIG_KEYS = [
  'dialogue.confirmationMode',
  'dialogue.language',
  'dialogue.speechOutput',
  'accessibility.captions',
  'accessibility.reducedMotion',
] as const;

/* ------------------------------------------------------------------ */
/* Consent                                                             */
/* ------------------------------------------------------------------ */

export interface ConsentState {
  /** Always true and not presented as an optional toggle. */
  necessary: true;
  analytics: boolean;
  decidedAt: string | null;
  policyVersion: string;
}

export const CONSENT_POLICY_VERSION = '2026-09-10';
