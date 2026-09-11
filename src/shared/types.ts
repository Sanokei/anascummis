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
  /** What this turn wants on screen, beyond its text. */
  surfaces: TurnSurfaces;
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

/* ------------------------------------------------------------------ */
/* Surfaces: what the assistant puts in front of you                   */
/* ------------------------------------------------------------------ */

/*
 * A surface is the second half of a reply. Text answers; a surface shows.
 *
 * The distinction matters because the two have different contracts. Text is
 * prefix-stable and streams — once a word is on screen it cannot be taken
 * back. A surface is a *thing* that appears, is manipulated, and stays: it can
 * be revised wholesale, and the person can move it, stack it, or close it.
 *
 * So a surface is addressed by a stable id and upserted, never appended. Two
 * turns that both talk about the same comparison update one window rather than
 * spawning a second one, which is what "always a step ahead" has to mean in
 * practice: the thing you were already looking at changes under you, instead
 * of a new thing arriving beside it.
 */

export type SurfaceBlockKind = 'text' | 'image' | 'code' | 'list' | 'fields' | 'links';

/**
 * One piece of a tab. Deliberately a closed vocabulary of six kinds rather
 * than free markup: every kind has a renderer the host controls, so a surface
 * can never introduce a construct the client did not agree to draw.
 */
export interface SurfaceBlock {
  id: string;
  kind: SurfaceBlockKind;
  /** Shown above the block. Omitted for a block that is its own heading. */
  title?: string;
  /** Prose, for `text`. Blank lines separate paragraphs; `- ` starts a bullet. */
  text?: string;
  /** For `image`. Absolute https URL, or a `workspace:` artifact reference. */
  url?: string;
  /**
   * For `image`. Required, and never empty — a picture with no description is
   * unusable to anyone not looking at it, and the host refuses to surface one.
   */
  alt?: string;
  /** For `code`. A hint only; the client never executes it. */
  language?: string;
  /** For `list`. */
  items?: string[];
  /** For `fields`, in the order given. */
  fields?: { label: string; value: string }[];
  /** For `links`. */
  links?: { label: string; href: string }[];
  /** Shown beneath the block, quieter than its content. */
  caption?: string;
}

export interface SurfaceTab {
  id: string;
  title: string;
  /** A short right-aligned marker, e.g. a count. Optional. */
  badge?: string;
  blocks: SurfaceBlock[];
}

/**
 * How much room a surface is asking for, and how loudly.
 *
 * `emphasis` is the host's only lever on attention: `quiet` is a thing that is
 * simply available, `attention` is the one case where a window arrives on top
 * of what the person is looking at. It is spent rarely, because a surface that
 * always demands attention is one nobody reads.
 */
export type SurfaceEmphasis = 'quiet' | 'normal' | 'attention';

export interface SurfaceWindow {
  /** Stable across turns. Reusing an id updates the window in place. */
  id: string;
  title: string;
  subtitle?: string;
  /** Reference width and height in CSS pixels. The client may clamp these. */
  size?: { width: number; height: number };
  emphasis: SurfaceEmphasis;
  tabs: SurfaceTab[];
  /** The tab to bring forward when the window opens or is updated. */
  activeTabId?: string;
  /** What raised this window, in the assistant's own words. */
  raisedBy?: string;
  createdAt: string;
  updatedAt: string;
}

/** A window the assistant asked to close, by id. */
export interface SurfaceClose {
  id: string;
  reason?: string;
}

/**
 * Everything a turn wants shown, as one object.
 *
 * Sent whole on every turn rather than as a delta, because the client's
 * window set is small and a full picture is the only version of this that
 * cannot drift out of sync after a reconnect or a dropped frame.
 */
export interface SurfacePlan {
  /** Windows to raise or update, in the order they should be considered. */
  windows: SurfaceWindow[];
  /** Ids to close. Applied after `windows`, so a turn may replace one atomically. */
  close: SurfaceClose[];
  /** True when the plan is complete and anything absent should be left alone. */
  complete: boolean;
}

/* ------------------------------------------------------------------ */
/* Personas: the sphere wearing something                              */
/* ------------------------------------------------------------------ */

/*
 * A persona is a costume, not a character with its own judgement.
 *
 * The assistant stays itself — same memory, same limits, same honesty — while
 * the shell it is drawn in changes for a moment. That is the whole reason this
 * is a closed vocabulary of *ornaments* rather than a drawing API: a persona
 * that could draw anything would be a second thing with its own face, and the
 * product's premise is that there is one presence you are talking to.
 *
 * The vocabulary is small on purpose. Four ornaments is already a costume;
 * past that it stops reading as the same creature in a hat.
 */

export type PersonaTraitKind =
  | 'hat'
  | 'cap'
  | 'beard'
  | 'glasses'
  | 'monocle'
  | 'horns'
  | 'antennae'
  | 'crown'
  | 'scarf'
  | 'halo'
  | 'visor'
  | 'ears'
  | 'plume'
  | 'spikes';

export const PERSONA_TRAIT_KINDS: PersonaTraitKind[] = [
  'hat',
  'cap',
  'beard',
  'glasses',
  'monocle',
  'horns',
  'antennae',
  'crown',
  'scarf',
  'halo',
  'visor',
  'ears',
  'plume',
  'spikes',
];

export interface PersonaTrait {
  kind: PersonaTraitKind;
  /** `#rrggbb`. Checked for contrast against the shell before it may ship. */
  color: string;
  /** 0.6..1.4. Relative to the shell radius. */
  scale: number;
  /** Nudge from the trait's natural anchor, as a fraction of the radius. */
  offset?: { x: number; y: number };
}

/**
 * What a persona depicts. Declared by the author and enforced by the harness,
 * because the failure this prevents — a costume that reads as a specific real
 * person — is one no amount of colour checking would catch.
 */
export type PersonaSubject = 'archetype' | 'creature' | 'object' | 'seasonal';

/** One rehearsed beat: what the persona says, and the mood it says it in. */
export interface PersonaBit {
  id: string;
  /** The mood the shell takes while this bit plays. */
  mood: OrbMood;
  /** Authored lines, in order. Never generated at the moment of use. */
  lines: string[];
}

export interface Persona {
  id: string;
  /** Shown in the interface when a persona is on, so it is never ambiguous. */
  name: string;
  subject: PersonaSubject;
  /** One line describing when wearing this is appropriate. */
  occasion: string;
  /** The shell colour while this persona is worn. `#rrggbb`. */
  shell: string;
  traits: PersonaTrait[];
  bits: PersonaBit[];
  /**
   * How long the costume may stay on before it is taken off. A persona is a
   * moment, not a mode; one that never leaves stops being a joke.
   */
  maxDurationMs: number;
}

/* ------------------------------------------------------------------ */
/* The orb's mood                                                      */
/* ------------------------------------------------------------------ */

/**
 * What the shell is doing, as distinct from what the session is doing.
 *
 * `OrbState` in the client is about activity — listening, speaking, working.
 * A mood is about *manner*: the shape the shell holds while it does any of
 * those. They compose, which is why a persona can specify one without taking
 * over the activity reporting that the accessibility layer depends on.
 */
export type OrbMood = 'even' | 'bright' | 'deadpan' | 'mischief' | 'grave' | 'tender';

export const ORB_MOODS: OrbMood[] = ['even', 'bright', 'deadpan', 'mischief', 'grave', 'tender'];

/** The persona currently worn, or null for the shell's own face. */
export interface PersonaWear {
  persona: Persona;
  /** The bit playing, when one is. */
  bitId: string | null;
  /** When the costume comes off, whether or not anything else happens. */
  expiresAt: string;
  /** Why it went on, in the assistant's words. */
  reason: string;
}

/* ------------------------------------------------------------------ */
/* Surface and persona limits                                          */
/* ------------------------------------------------------------------ */

/**
 * Bounds the host enforces before anything reaches a client.
 *
 * `MAX_SURFACE_WINDOWS_PER_TURN` and `MAX_OPEN_SURFACES` are ceilings on
 * *count*, and count is the one thing the host does not negotiate: six
 * genuinely different things are six windows, and dropping three of them to
 * keep the screen tidy would be the host withholding work the person asked
 * for.
 *
 * What scales instead is *manner*. As more is open the host spends less
 * attention per surface — lower emphasis, no focus stealing, no arrival
 * motion — so the tenth window is a thing that is simply there rather than a
 * tenth interruption. `restraintFor` in the worker's surface module is that
 * ladder; these are only where it runs out.
 */
export const MAX_SURFACE_WINDOWS_PER_TURN = 6;
export const MAX_SURFACE_TABS_PER_WINDOW = 6;
export const MAX_SURFACE_BLOCKS_PER_TAB = 24;
export const MAX_OPEN_SURFACES = 12;
export const MAX_PERSONA_TRAITS = 4;
export const MAX_PERSONA_BITS = 6;
export const MAX_PERSONA_LINES_PER_BIT = 3;
/** Long enough for a real sentence, short enough to stay a beat. */
export const MAX_PERSONA_LINE_CHARS = 180;

/* ------------------------------------------------------------------ */
/* Surfaces on the wire                                                */
/* ------------------------------------------------------------------ */

export interface TurnSurfaces {
  /** The windows this turn wants present. */
  windows: SurfaceWindow[];
  /** Ids this turn wants gone. */
  close: string[];
  /** Null when nothing changed, so the client can skip a render. */
  plan: SurfacePlan | null;
  /** The costume the shell is wearing, if any. */
  persona: PersonaWear | null;
}
