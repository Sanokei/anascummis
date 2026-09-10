# Anascummis — End-Product Specification

**Purpose:** Define the finished product for an implementation agent. This is a product contract, not a roadmap, sprint plan, milestone list, or claim that these features already exist.

**Specification date:** 2026-09-10.

## Product and goal

**Anascummis is a general-purpose, conversational-first assistant with an authored personality.** A user talks naturally, asks questions, explores an idea, changes direction, or asks it to do something. Anascummis maintains the thread, finds relevant information and skills, and performs permitted work without turning the interaction into a menu or requiring the user to manage tools and agents. Voice is a primary interface; text input and clickable choices are fully usable alternatives.

The goal is continuous, responsive conversation that can lead to real, inspectable outcomes: a useful answer, researched information, an organized task, a created artifact, or an authorized action through a connected service. Ordinary conversation is itself a valid outcome. The assistant must not invent a software project, deploy a Worker, generate code, or install a skill merely because the user started talking.

**Software creation is a supporting capability, not the product's primary purpose.** When an existing tool or skill can accomplish a request, use it. When an important capability is genuinely missing, Anascummis can build and validate a bounded extension or workflow. It should build the mechanism needed to do the job rather than merely claim the job was done, but many jobs need no new mechanism at all.

Ink represents conversational flow and continuations. Registered story functions expose bounded operations through sandboxed Lua and trusted host bindings. A Skill Harness discovers and applies reusable procedures with real tool use. Separate Ink and Lua generation harnesses validate extensions before publication. A conservative, elastic pool of DeepSeek agents prepares independent work without taking conversational control away from the user.

**Governing rule:** Conversation supplies intent; skills supply relevant procedures; Ink composes behavior; Lua implements bounded capabilities; the host and registry authorize execution. The LLM proposes actions and extensions but cannot authorize itself.

## Baselines and stack

Use **Sanokei/iJester** as the speech/session and low-latency action-gating baseline, not as a requirement to make a reaction soundboard. Its public implementation separates microphone/transcription handling, a DeepSeek proposal, and host-side reaction gating. Adapt that separation for general conversation and richer tools.[^ijester]

Use **Sanokei/NarrAItor**, exactly `https://github.com/Sanokei/NarrAItor`, as the user's self-modding assistant baseline. The inspected project is a C#/.NET implementation with LLM bindings and Lua integration. Reuse the relevant mod-authoring and binding ideas, adapted to the selected stack; do not substitute a similarly named repository.[^narraitor]

Use **astrochili/narrator** as a separate, useful third-party **Ink-in-Lua runtime/binding reference**. Its passive book versus active story distinction, external-function binding, navigation, and state persistence are relevant. It is not the user's NarrAItor project. Its documented Ink support has limitations, and source parsing depends on LPeg: prove the chosen feature subset, compiler/runtime compatibility, and Workers/WASM integration rather than assuming a drop-in JavaScript dependency. A compatible alternative is acceptable when its behavior is tested against the required contract.[^lua-ink]

Adapt the baselines deliberately. NarrAItor's reviewed code exposes host methods through reflection, includes a Lua-to-LLM path, and uses a model-response text check in one mod-validation path. These are reference implementation details, not Anascummis's permission or safety contract. Replace broad binding exposure with explicit grants, move model calls to the trusted orchestrator, and require actual compiler/sandbox/contract tests rather than an LLM saying it approves.[^narraitor-binding][^narraitor-forge]

Use the user's existing local **SlopSquash** project as the authentication and social-login baseline. The user confirms it is already on their local drive. The implementation agent should locate and inspect that checkout in its accessible local workspace before choosing authentication libraries, providers, session handling, or account-linking contracts. Do not require a new clone when the local project is available, invent its path, or substitute a similarly named project. Adapt suitable authentication code, configuration patterns, and tests to Anascummis's stack and privacy requirements. This specification revision has not inspected SlopSquash's source. Preserve applicable licenses and attribution for every reused dependency and file; public visibility alone is not a license to redistribute code. Do not copy credentials or account identifiers.

The finished stack is **Bun for package management and development tooling; TypeScript; React; Tailwind; the Next.js application API surface through vinext/Vite; and Cloudflare Workers configured and deployed through Wrangler**. Bun is not the deployed Workers runtime. Pin dependencies and test the selected vinext features on Workers; Cloudflare documents vinext as its preferred Next.js path, with beta/compatibility qualifications.[^cf-next]

Whisper is the transcription baseline. DeepSeek Flash is the latency-oriented conversational model family, with a separately configurable Pro-class route for demanding work. The requested V4.1 preference must resolve to a verified provider model identifier. Do not invent an endpoint, silently substitute a model, or preserve an old scaffold default merely because it exists. iJester's reviewed DeepSeek adapter performs constrained JSON classification; Anascummis additionally needs tested, structured tool-call/result handling and the actual selected provider's supported streaming/cancellation behavior. Keep model and transcription adapters configurable.[^ijester-deepseek]

The earlier Ink-only scaffold is not authoritative where it conflicts with this specification. **Both Ink and Lua are required; the product is not a coding-only agent.**

## Reuse from existing agent harnesses

Use existing, appropriately licensed code and documented patterns rather than reimplementing every mechanism from scratch. **Codex CLI** has public source under Apache-2.0. Its reviewed tool registry provides concrete references for named handlers, duplicate-name handling, tool exposure, parallel-call eligibility, and typed dispatch failures. Adapt useful components or patterns with attribution; this does not imply access to model weights or every hosted Codex service.[^codex][^codex-registry]

Use **Claude Code's documented skills and layered-context behavior** as a design reference. The public `anthropics/claude-code` repository's root license says all rights reserved and refers to commercial terms; do not assume the complete engine is permissively open source. Reuse separately licensed examples/components only under their actual terms, or implement the documented interface and behavior independently.[^claude-license][^claude-skills]

Neither CLI becomes the required Anascummis production runtime. Port relevant mechanisms into the DeepSeek/Cloudflare architecture and verify their assumptions about filesystem access, subprocesses, authentication, model protocols, and persistence. Compatibility with one CLI's skill format does not imply arbitrary scripts or CLI internals run inside a standard Worker.

## Conversation, personality, and speech

The experience must feel like a continuous conversation, not a spoken multiple-choice menu. The main agent receives the current Ink choices, relevant recent context, task constraints, and a limited registry view. It interprets the user's meaning instead of requiring exact button text.

Provide reusable, validated open-conversation states for free-form replies. A harmless exchange need not generate a new Ink file or invoke a tool. Dynamically generated dialogue text is data within the permitted continuation, not executable Ink or authorization. New action-bearing paths still pass the Ink harness.

Preserve the supplied Anascummis personality conversation as versioned reference scenes and authored dialogue. When the same situation and intent recur, prefer the approved wording rather than an unnecessary paraphrase. For analogous situations, adapt the scene's conversational pattern. For genuinely new situations, preserve the demonstrated voice without inserting unrelated jokes. The available voice is competent, understated, and situationally absurd. Its personality applies to everyday conversation as well as task execution; it is not restricted to software-building dialogue. Personality must never override truthfulness, consent, or execution policy. Do not invent missing canonical exchanges from a partial source excerpt.

The canonical name is **Anascummis**; the accepted aliases are **Anas** and **Cummis**. Match complete names case-insensitively, never substrings. These are entity-recognition candidates, **not wake words**: no name match may activate or resume listening, select a branch by itself, or authorize an action. An exact name can still refer to another person or appear in a quotation.

Whisper receives a short vocabulary hint containing the correct names and currently relevant technical terms, where the selected adapter supports prompting. Hints are not replacement rules. Preserve the raw transcript separately from interpreted meaning. Do not depend on native streaming merely because the model is Whisper: OpenAI's hosted `whisper-1` does not support its file-streaming transcription mode; the chosen deployment needs a tested chunking or streaming strategy appropriate to its actual interface.[^speech]

“Ask Chris,” “ask,” “Abe,” “Asus,” and “Ace” are possible evaluation cases, not additional aliases or automatic corrections. If an uncertain opening name is irrelevant to an otherwise clear request in an active conversation, leave it unresolved and answer. If resolving it changes the recipient, target, identifier, quantity, negation, or action, clarify. Never reinterpret “Ask Chris to delete the Worker” as authorization for Anascummis to delete it.

Reuse the normal semantic choice resolver for contextual terminology interpretation rather than adding a model call to every turn. A text-only resolver has no new acoustic evidence, and its self-reported confidence is not a calibrated probability. User-confirmed corrections may become scoped examples; they never become blanket replacements or execution authority. Guest corrections are session-only. Durable personal corrections require login and enabled persistence.

Microphone capture requires explicit session activation and browser permission, with visible listening status and immediate controls to stop capture. Silence, background audio, duplicate chunks, and the assistant's own playback must not create executable turns. Partial transcripts may prepare non-executing work but cannot authorize consequential actions. Provide editable transcripts, text input, and optional interruptible spoken output. Use transcription, not automatic translation, unless translation is requested.[^microphone]

Do not copy iJester's silence-artifact word filter unchanged: its reviewed transcription adapter discards some complete utterances including “thank you” and “bye.” Those are valid conversational inputs here. Suppression must consider actual capture/silence/echo evidence, not categorically discard ordinary conversational phrases.[^ijester-whisper]

## Dialogue runtime and Ink harness

The normal runtime is:

```text
Explicitly captured speech or submitted text
  → Whisper when audio is used
  → contextual interpretation / DeepSeek choice resolver
  → relevant skill activation when useful
  → validated Ink story or existing open-conversation continuation
  → host confirmation and authorization gate
  → capability registry
  → bounded Lua sandbox and granted host bindings
    (search, retrieval, service tools, or approved skill-script execution)
  → structured result
  → Ink continuation
  → visible response and optional spoken output
```

The resolver can match an existing choice, ask a focused clarification, handle a conversational deviation, navigate backward, or stop. It must be allowed to leave all current choices unmatched. A user question such as “Before that, what will it cost?” suspends the pending decision, handles the question, and returns without fabricating an answer to the original choice.

Use Ink knots and diverts for narrative navigation.[^ink] Within-story call/return behavior may use supported tunnels. Cross-story interruptions belong to a host-managed continuation stack containing the exact story version, runtime snapshot, pending decision, and return contract. A jump to a knot is navigation, not a complete historical undo.

Keep Ink source and compiled artifacts immutable and versioned. Do not patch a running story's source in place and assume its saved state remains compatible. A generated detour is a separately validated fragment or a new story version entered at a safe boundary. Restore a snapshot only against compatible compiled content; otherwise use an explicit state migration or return to a safe checkpoint.

The **Ink Story Harness** must generate against a registry contract snapshot and validate the emitted artifact. Validation covers real Ink compilation, declared entry and return points, every possible action reference, supported argument representations, available capabilities, permissions, confirmation requirements, and bounded execution. Use compiler-level analysis or a constrained, validated intermediate representation; regex matching alone is insufficient. Runtime input validation remains necessary where values cannot be established statically. Loop analysis is best-effort; a host execution budget is mandatory.

All action targets must be statically enumerable. Reject arbitrary Lua paths, dynamic capability-name construction, undeclared external functions, and disguised calls in unvalidated metadata. Use actual supported Ink syntax: do not treat illustrative JavaScript objects or dotted properties from earlier discussion as valid Ink code.

Every unresolved capability must produce a structured diagnostic. The authoring agent either proposes the missing capability explicitly to the Lua Forge or rewrites the story using installed capabilities. A proposal is not an installed function. **No executable story version may contain an unresolved action reference, even on an unselected branch.**

While a needed capability is being built, a separately validated waiting or conversational fragment may continue. The dependent fragment stays unpublished until its requirements exist and it passes revalidation. A failed or denied proposal leaves a coherent alternative or honest unavailable state, never an invented successful result.

Asynchronous work must pass through an explicit host yield/resume protocol. Ink evaluation produces an action request; the host validates and schedules it, then supplies a typed result or failure at the continuation. Compilation, lookahead, rendering, replay, and branch inspection must not execute external side effects. Default to three story-action dispatches per user turn, with additional host-enforced compute, elapsed-time, and external-call budgets. Exhaustion yields a visible paused state; a new fragment, retry, worker, or automatic re-entry cannot silently replenish the same task budget.

## Registry, Lua, and the Story Function Forge

The registry is an authoritative executable catalog, not a list of tool names in a prompt. Each entry identifies its owner/workspace scope, stable capability ID, immutable version and source hash, input/output contract, granted permissions, risk classification, timeout/resource budgets, validation evidence, installation status, and cancellation/idempotency behavior. Execution requires an installed, non-revoked version plus current session authorization. Historical validation cannot override later revocation.

Provide a useful seed registry for web search and bounded page retrieval, permitted file/content search and reading, skill discovery/loading, workspace artifact operations, approved script execution, validation/testing, and supported connected-service actions. Include the relevant baseline audio and Cloudflare capabilities without making them the only useful functions. Search must return usable source identifiers/URLs and retrieved evidence, not merely an LLM-generated answer. Memory functions are permission-gated by identity and persistence settings. Expose external services only when the actual adapter and required authorization exist.

Native tools are trusted host adapters with registry contracts, surfaced to Ink through explicit Lua bindings where appropriate. The orchestration/authoring harness also has a small preinstalled, policy-gated tool surface for discovery, reading, and validation; it must not need to invent a Lua file simply to read a skill. These host calls share the same permission checks, accounting, and audit records. They are not a second unrestricted execution path. A generic arbitrary shell, unrestricted network call, or raw provider credential is not an acceptable shortcut.

The **Story Function Forge** is a separate authoring harness. It first checks for a contract-compatible existing capability or an Ink composition of existing functions. Similar names alone do not establish compatibility. When new Lua is necessary, the Forge requires a capability specification, least-privilege manifest, implementation, tests, and reviewable validation report.

A publishable candidate must pass syntax checks, schema/contract checks, prohibited-operation checks, permission checks, resource-limit tests, and execution tests inside the actual selected sandbox. Tests include malformed inputs, failures, cancellation, unauthorized access, and attempted sandbox escape—not only successful examples written by the same model. Fixed host-authored tests and independently derived contract tests constrain model-generated tests. Passing tests is evidence, not proof of general safety.

Default to **three total candidate attempts per capability request**, including the initial attempt and repairs. Ink repair is similarly bounded. These limits apply inside a shared task budget; switching harnesses, renaming a request, or returning through Ink cannot reset it. After exhaustion, return a structured failure and preserve the last valid state. Installation is policy-approved and atomic; permissions outside the granted envelope require explicit approval. Drafts never execute in live conversations.

Lua is leaf execution. It can compute over validated arguments and use specifically granted host bindings, then return bounded structured data. It cannot spawn agents, call the LLM, invoke another Lua capability, register modules, change its manifest, edit its executable source, or load code dynamically. It may return proposed non-executable narrative data, but generated Ink still passes the Ink harness.

Run untrusted Lua in a genuinely resource-bounded, interruptible isolation boundary. Removing standard-library names or using a JavaScript timeout around a blocked interpreter is insufficient. Restrict filesystem scope, network destinations, memory, instructions/CPU, elapsed time, output size, and host-call counts. Keep secrets in the trusted host and expose only scoped operations. Generated Worker applications and skill scripts require equivalent isolation; running on Cloudflare does not by itself make generated code trusted.

## Skill Discovery and Execution Harness

Skills are reusable instructions, references, assets, and optional scripts for accomplishing a type of task. They are not synonymous with Lua story functions, tools, plugins, or model weights. Implement the Agent Skills `SKILL.md` format and staged loading: catalog metadata first, relevant instructions on activation, then supporting files as needed.[^skills-format][^skills-client]

The finished harness must perform the whole cycle:

```text
User intent + current context
  → discover relevant available skills
  → select a useful skill or none
  → load its pinned instructions and needed resources
  → resolve the tools, permissions, and execution environment it needs
  → use existing capabilities or propose a missing bounded capability
  → run the authorized procedure with structured tool results
  → verify the outcome and return it to the conversation
```

**Discovery and automatic use.** Search the installed/bundled catalog first. When a real gap remains, search approved public skill sources through working search/fetch tools. Support user/workspace skill packages and compatible `.agents/skills/` and `.claude/skills/` layouts or equivalent remote catalogs; do not assume access to the user's desktop. Use descriptions, task context, and compatibility to choose a small relevant set. A trusted, enabled skill within already granted permissions is activated automatically without requiring the user to name it. “No skill needed” is a valid result. Respect explicit-only or disabled automatic-invocation metadata and user overrides. Do not invent a skill or capability that discovery did not return.

**Identity and trust.** Catalog entries record origin, qualified name, immutable revision/content hash, license, description, compatibility, dependencies, allowed invocation mode, and effective tool permissions. A discovered package is not automatically installed or authorized. Stage unknown packages; inspect their metadata, resources, scripts, and execution requirements before activation under policy. Permit automatic activation of vetted packages within existing grants, while new access, cost, or untrusted executable installation requires the applicable approval. Duplicate names cannot silently shadow a trusted skill. Updates are new versions requiring validation; revoked versions cannot run.

**Real tool use.** The harness gives DeepSeek actual structured tool definitions and consumes structured calls/results, not pretend commands embedded in prose. Every proposed call passes through the host dispatcher and the active story or authorized job contract; an SDK must not auto-execute a raw model response outside those controls. It must search for information, retrieve cited sources, inspect permitted user files, and execute supported skill procedures as the task requires. A skill may help answer a question without creating software. Loading instructions is not execution, and a completed tool call is not proof the user's goal was achieved. Keep a run record identifying the skill version, task, capability versions, permission envelope, outputs, and observed errors.

**Registry compatibility.** Resolve every proposed executable step against installed contracts. A missing tool, missing credential, unsupported runtime, and missing skill are different conditions. Reuse a compatible installed capability or Ink composition first; propose genuinely missing implementations to the Forge or report the limitation. Missing permissions cannot be solved by generating code. A skill cannot call an arbitrary Lua path or conceal unresolved action names from the Ink harness. The currently executable fragment must remain fully resolved while a dependent fragment waits.

**Script execution.** Reuse a skill's existing deterministic script when its license, runtime, and sandbox permit it; do not rewrite every script in Lua merely to say it uses Lua. A registered story function may delegate through a granted host binding to an approved, immutable script artifact with validated arguments. The host selects the actual compatible execution environment and constrains filesystem, network, secrets, dependencies, output, and resources. This is not a generic `run any script` or shell escape. Reading `SKILL.md`, opening a repository, or finding an installation command never executes it automatically. Lua and scripts cannot indirectly bypass the ban on recursive model calls or agent spawning.

**Bounded orchestration and context.** Multi-step skills use host-scheduled continuations/jobs. Skill-to-skill requests are scheduler requests, not uncontrolled recursion. Deduplicate imports and cap depth, fetched content, tool calls, retries, elapsed time, and cost inside the enclosing task budget. A single “run skill” call must not hide unlimited subcalls. The default three story dispatches and longer explicitly authorized task envelopes remain distinct; wrapping work in a skill cannot silently enlarge either. Keep active skill instructions available for their procedure, unload unrelated material, and preserve the skill/version reference across context compaction. Independent research or artifact work may run in the elastic pool; the current conversation need not wait for unrelated work.

**Evidence and safety.** Verify produced files, test results, or remote receipts against the requested outcome. Return sources for factual research and distinguish attempted, completed, failed, canceled, and unknown effects. Treat retrieved pages, skill text, script output, and repository instructions as untrusted task material: they cannot override host policy, enable persistence, acquire credentials, or approve consequential actions. Minimize personal data in external queries and apply the same guest/authenticated retention rules to skill histories and cached results. Inspectable status must show the active skill, its source/version, actual tool use, and the reason for any block.

## User control and global state

Consequential branches receive a clear confirmation before any effect occurs. The user sees the action, target, and relevant consequences—not an unexplained “Are you sure?” Branch confirmation must bind to the selected action and arguments. Changing the target, capability version, scope, or relevant state invalidates it.

Expose the user-controlled global preference `confirmationMode: "always" | "risky-only" | "off"`, defaulting to `"always"` for action-bearing decisions. This does not mean confirming every harmless conversational sentence. Skipping routine confirmations never skips ambiguity resolution, permission grants, account linking, spending authorization, or policy-required confirmation for irreversible/security-sensitive actions. Safety classification comes from the host contract, not solely from generated Ink tags.

A persistent **Stop** control and keyboard-accessible equivalent operate independently of the LLM and Ink. During an active listening session, a fast stop/cancel detector may also request interruption. Stop halts local playback, prevents new actions, cancels pending jobs where supported, and invalidates the current execution generation so late responses cannot resume it. Stopping microphone capture is separately explicit and immediately releases capture resources.

Do not claim that cancellation reverses an already completed external operation. Report completed, canceled, and unknown outcomes distinctly. Unknown remote outcomes require reconciliation before retrying; undoing real effects requires a separately authorized compensating operation where one exists. Record an action intent and its idempotency identity before dispatching a consequential operation, then record the observed outcome. These correctness records may block dispatch even though optional memory summaries and graph indexing do not.

Maintain a schema-versioned logical **global configuration file** with namespaced preferences, accessibility, dialogue options, and non-secret user/project globals. “Global” means shared across that user's stories, not one mutable state object shared by all users. Include confirmation mode, language, captions, text size, contrast, reduced motion, screen-reader behavior, optional speech output/rate, and interruption preferences. Runtime microphone permission is not a saved Boolean that can reopen a device.

Ink reads an allowlisted view of these values. Changes use validated host setters; generated stories cannot rewrite policy, persistence permissions, spending limits, or credentials. Ordinary globals may evolve without forcing everything into a single memory file. Accessibility settings may be retained locally without an account where appropriate; server-side durable preferences follow authenticated persistence rules.

## Elastic agents and responsiveness

Hot and cold describe latency priority, not a limit of two processes. The system has one conversational authority per active session and a dynamic pool of independent jobs: research, skill discovery/execution, artifact processing, Ink authoring, Lua Forge, workspace files, tests, contextual preparation, and maintenance. A job becomes a separate DeepSeek agent only when model reasoning is useful. Deterministic validation and storage do not need their own LLM agents. A worker agent is a bounded job/model context, not necessarily a newly deployed Cloudflare Worker or a new account.

The scheduler conservatively expands based on independence, urgency, expected conversational usefulness, estimated latency savings, token/compute cost, contention, and merge risk. It reuses work and deduplicates equivalent requests. More concurrent work requires stronger justification. The objective is to prepare the likely next conversational needs with the minimum useful parallelism, not maximize worker count.

Do not encode a permanent product rule such as “exactly four agents.” Nevertheless, every admission decision must fit enforced remaining spending, token, compute, time, queue, and provider-rate budgets. Reserve estimated costs before spawning and reconcile actual use afterward. The effective concurrency ceiling changes with those budgets and observed performance. Neither the model nor a worker can raise limits. More agents do not guarantee completion.

Only the scheduler spawns workers. Workers can return dependency requests, not recursively create descendants. Dependency cycles, unbounded fan-out, repeated failures, and duplicate proposals are rejected. Required interactive work takes precedence over speculative work; optional work can be canceled when the user changes direction or resources become constrained.

Workers receive narrow task context and isolated workspace branches or equivalent versioned change sets. Results are validated proposals, not direct writes to the canonical workspace. Integration checks the expected base version and conflicts. Only the session coordinator can update the active story or conversation HEAD. Results carry session, branch, task, and generation identifiers so stale work cannot modify a newer direction.

Speculation may draft code, inspect permitted data, compile, and run isolated tests within its budget. It must not send messages, mutate connected accounts, deploy publicly, or take other consequential action because the user is predicted to agree.

The normal conversational path uses cached relevant context and installed capabilities. It does not regenerate Ink, traverse the entire history graph, summarize memory, or wait for unrelated file creation. Await work only when the response or authorized action actually depends on it. Long-running jobs need supported Cloudflare job execution and cancellation semantics, not an assumption that a detached promise lives indefinitely after a request ends.

Stream output where supported and deliver completion events at sensible dialogue boundaries. Distinguish a spoken acknowledgment from actual task completion. Measure end-of-speech-to-transcript, first meaningful response, optional audio start, orchestration overhead, dependency waits, cancellation, and total task latency at p50/p95 under documented conditions. Near-real-time behavior is a measured product goal, not a guarantee inferred from a model's name.

## Layered context and versioned conversation memory

Use **Claude Code's documented layered-context pattern**, not a custom Chalet-inspired semantic compression system. The relevant pattern is scoped instruction files, topic/path-specific context loaded when relevant, and a concise memory index pointing to separate topic files. Claude Code distinguishes authored instructions from learned memory and treats both as context rather than enforced security policy.[^claude-memory]

Adapt that pattern for DeepSeek and Cloudflare storage; do not require the Claude Code CLI as the application runtime or claim to embed its proprietary internals. A small Memory Manager resolves scopes, loads relevant files, applies retention, and maintains provenance. Its logical hierarchy is global product guidance, user preferences, project/task context, relevant topic memories, and immediate conversation state. Host-enforced constraints remain outside this hierarchy.

Always retain explicit **mission**, **current task**, and **current focus**, with accepted constraints and unresolved decisions. These describe the user's actual intent; casual conversation may have no active task, and the manager must not fabricate one. Working context includes roughly the last three relevant Ink units/checkpoints plus the current knot, choices, variables, recent turns, and needed action results. Three is a working-context target, not permission to discard an older constraint that still matters. Missing required context triggers retrieval or clarification before dependent action.

The memory index routes retrieval; it is not one ever-growing `memory.md` containing everything. Detailed memories carry source references, scope, revision, and supersession information. Proposed summaries cannot silently overwrite user-confirmed facts. Branch-specific hypotheses must not become global truth, and context assembled for a worker includes only the sources its task needs. Validate import paths and cycles; memory content cannot elevate authority.

Conversation history is an immutable checkpoint DAG with one active HEAD per session. A checkpoint references parent checkpoint(s), Ink source/compiled version, compatible full runtime state or a bounded delta chain, continuation state, task/context revisions, active skill versions, and action receipts. Store enough state to restore actual execution position—including state beyond a knot name and a few variables. Periodic full snapshots bound restoration cost; shared Ink artifacts are stored once per immutable version.

“Go back” restores a compatible historical checkpoint and creates a new branch without erasing the abandoned future. Ordinary Ink diverts can remain cyclic while checkpoint ancestry stays acyclic. Semantic navigation can search labels and summaries; clicking a known checkpoint requires no model search. Replaying a checkpoint must never replay external actions.

The conversation map distinguishes current, inactive, archived, and pinned branches. Pruning must preserve reachable snapshots/artifacts, active continuations, and references required by retained memories. Archive retained decisions and their reasons, but explicitly mark lost detail when source content is removed; do not promise recovery after deletion. User deletion and retention expiry override pins and remove associated content and indexes. Conversation restoration cannot restore revoked permissions or undo current global safety settings.

**Cloudflare KV is the short-lived conversation cache, not a synchronization authority.** Its eventual consistency makes it unsuitable for transactional HEAD updates or immediate permission revocation.[^kv] Use a serialized session coordinator, such as an appropriately scoped Durable Object, for live decisions, generation fences, and action ordering. Guest coordinator state and job data remain ephemeral or explicitly expiry-bound; coordinator storage must not become hidden long-term guest memory. Authenticated durable history and memory use D1.

## Workspaces and Cloudflare integration

Every session has an isolated logical workspace for task inputs, artifacts, relevant skill resources, versioned Ink, proposed Lua, and any generated files/tests. Materialize execution resources only when the task needs them; an ordinary conversation must not automatically create a temporary account or public deployment. Session/tenant boundaries apply to reads, writes, logs, network access, and generated previews. Worker-agent branches are subordinate to that workspace. An ordinary application Worker must not be assumed to provide an unrestricted shell or persistent filesystem; use a supported Cloudflare execution/workspace mechanism appropriate to the chosen runtime.

Guests can request a temporary Cloudflare preview account/workspace without owning a Cloudflare account. Use the documented provisioning interface, collect the required provider-policy acceptance, handle proof-of-work/rate limits, and show the actual returned expiry and supported resources. This is a temporary preview path, not unlimited anonymous compute. Cloudflare documents backend-controlled preview provisioning and subsequent claiming.[^cf-preview-api]

Keep temporary API credentials server-side. Show the preview URL and owner-only claim URL appropriately; treat the claim URL as sensitive. Do not leak either credential through generated code, model prompts, telemetry, or public artifacts. Respect the returned expiry and clean up session copies. Claiming a temporary account does not automatically grant Anascummis ongoing deployment access; later access needs the appropriate separate connection.[^cf-preview]

Provide **Connect Cloudflare** using a registered OAuth2 client, least-privilege scopes, explicit account selection, and revocation/disconnect controls. Follow Cloudflare's published OAuth integration, including required client registration.[^cf-oauth] Keep application login separate from Cloudflare resource authorization. A connected account does not authorize deployment by default, and connecting Cloudflare does not silently enable Anascummis memory.

Default deployment work to an isolated preview rather than the user's production resources. Promotion to a connected account requires an explicit target and applicable action/spending approval. If temporary provisioning is unavailable or a required resource is unsupported, preserve available local/session work and state the limitation; do not fabricate a preview or create accounts repeatedly to evade limits.

Bundle a curated, version-pinned selection of **Cloudflare's public Agent Skills**, including relevant Cloudflare, Wrangler, and workspace guidance. The public repository supports consuming skill folders separately from its plugin/MCP packaging; do not make a Cloudflare MCP server mandatory. The reviewed Cloudflare skill routes to relevant products/resources, and Wrangler guidance calls for inspecting the actual project/version and retrieving current documentation. The harness therefore needs working search, page retrieval, and permitted execution tools—not merely the files in its prompt.[^cf-skills][^cf-skill-files]

Cloudflare skills are a required initial collection, not the boundary of the general-purpose skill system. Include usable research/retrieval and artifact-handling procedures backed by actual seed tools, whether appropriately licensed imports or project-authored skills. Loading any skill grants no permissions; all scripts and operations follow the same harness and registry rules.

## Identity, persistence, and consent

Support guest use and authenticated use. Inspect and adapt the authentication and social-login implementation from the user's local SlopSquash checkout, including suitable sign-in UI, provider integration, callbacks, session management, logout, and tests where present. Verify what SlopSquash actually implements rather than assuming its providers or framework. The finished integration must provide secure sessions, CSRF protection, checked OAuth state/redirects, PKCE where applicable, and deliberate account linking. Keep tokens server-side and encrypted at rest where stored; never place secrets in prompts, client-readable preferences, or generated files. Login, Cloudflare authorization, microphone permission, cookie choices, and memory persistence are separate controls.

Guests have transient conversation context, expiry-bound KV/cache/workspace data, and session-scoped corrections. They do **not** have long-term user memory, durable conversation history, or durable personal preference records in Anascummis's D1. Necessary temporary processing must be disclosed honestly; “no long-term memory” does not mean “no server ever processes or temporarily stores data.”

Authenticated users may enable durable D1 memory, preferences, and history. Login is necessary but does not authorize every form of retention. Offer an inspectable memory setting and deletion/export controls. Do not silently import all guest history on login; explicitly offer to keep the current work. Logout clears account-scoped client state and revokes its session access. Every durable write checks identity, ownership, and persistence policy server-side, including delayed worker results.

A temporary D1 database created for a user-requested preview application is separate from Anascummis's long-term memory database. It must not become a loophole for retaining anonymous conversational memory. Temporary artifacts, queued payloads, transcripts, logs, traces, and branch archives all follow the applicable retention boundary. Operational security records must be minimized and separately disclosed rather than used to preserve conversation contents.

Ship accessible **Privacy Policy**, **Terms of Service**, and **Cookie Policy** pages that describe actual behavior. Explain microphone/audio processing, transcription/model providers, skill and search providers, connected-service operations, generated workspaces, third-party deployments, temporary versus durable storage, retention, account linking, deletion/export, contact details, and applicable processing/transfer arrangements. State that speech recognition and generated code can be wrong and that stopping or restoring a conversation cannot necessarily reverse completed external actions. Do not invent a legal entity, provider guarantee, or retention period.

Terms must explicitly explain the voice feature, but acceptance of terms does not replace browser microphone permission or optional tracking choices. Do not retain raw audio by default. Any separately offered recording retention requires a clear choice and matching deletion behavior. Policy claims must match implementation and receive appropriate legal review before public launch; this specification is not a compliance certification.

Provide the requested **bottom-left cookie-consent panel/dialog**, responsive on small screens and usable with keyboard and screen readers. Explain strictly necessary storage and present optional categories disabled by default. Give equally accessible **Necessary only**, **Accept optional**, and **Manage preferences** choices; do not load optional trackers before consent or after refusal. CNIL identifies both premature cookie placement and harder refusal mechanisms as compliance problems.[^cookies]

Cookie settings remain accessible after dismissal, and withdrawing consent actually stops optional processing. Apply this policy to comparable browser storage, not only cookies. Keep consent storage minimal and do not use it to fingerprint guests. The panel must not obscure microphone/Stop controls or block essential accessibility functions. Necessary storage is explained as required for its actual purpose, not presented as an optional toggle that falsely promises the feature will still work.

## Finished interface and observable behavior

The primary interface is a conversation/transcript with clear microphone and optional playback controls, a persistent Stop action, and the current topic or task when one exists. Skills, jobs, files/artifacts, capabilities/proposals, branch history, account connections, accessibility, and memory/privacy controls are inspectable secondary views. This is not principally an IDE, deployment dashboard, or agent-management console. Failures, permission requests, expiry, conflicts, and unsaved guest work are visible states rather than hidden logs.

A user can hold an ordinary conversation without creating code or a project. A paraphrase of an Ink choice follows the intended existing path without unnecessary generation. A question outside those choices becomes a validated detour and returns to the unresolved decision. Familiar authored situations preserve the personality's approved lines; unrelated situations do not trigger canned jokes.

A factual research request uses working search/retrieval tools and relevant skills, returning evidence rather than inventing search results. An artifact request can use an existing supported skill script and return a verified artifact without forging new Lua unnecessarily. A connected-service request uses the actual authorized adapter and applicable confirmation. The user need not explicitly ask the assistant to find or load the relevant trusted skill.

A missing function becomes an explicit, bounded Forge proposal. Until installation and Ink revalidation succeed, the dependent story cannot execute. Independent conversation, research, or file work can continue. A failed build stays failed; a successful worker result cannot modify a canceled or superseded branch. A skill that requests unavailable tools, an incompatible runtime, excessive permissions, or unsafe recursive execution is blocked with an accurate reason rather than silently executed.

A user can stop work, change direction, and branch from an earlier checkpoint without repeating an external action or forgetting a still-applicable constraint. Guest use leaves no long-term Anascummis memory; account persistence saves only authorized data. An ambiguous name never starts listening or authorizes an action, and refusing optional cookies genuinely prevents optional tracking.

## Delivery contract for the implementation agent

Deliver the integrated product described here, not a collection of placeholder modules or planning documents. Choose the implementation order from actual dependencies and keep working through integration and verification without inventing milestone approval gates. Real-world consent, credentials, permissions, and spending approvals remain required where specified; implementation autonomy does not waive them.

The deliverable includes application source, verified baseline attribution, reproducible Bun tooling, Wrangler/binding configuration, D1 migrations, seed capabilities and authored stories, the Ink Story Harness, Lua Forge, complete Skill Discovery and Execution Harness, real provider/search/tool adapters, isolation and scheduling, the complete interface, policy pages, and automated checks for the behaviors above. Tests must cover failure, concurrency, stale results, cancellation, restoration, invalid capabilities, privacy boundaries, consent, and speech false positives as well as successful paths. Skill checks include automatic versus explicit-only invocation, no-skill decisions, provenance/version collisions, denied tools, prompt-injection attempts, unsupported scripts, revocation, shared budget exhaustion, and verification of non-coding outcomes. Real audio and deployed-platform tests supplement mocks; unrun checks must be reported as unrun.

Do not label a mock, configuration file, or simulated deployment as a working integration. When an external prerequisite is unavailable, isolate the affected feature and report the exact blocker while completing independent work. Keep the final implementation report grounded in files changed, tests actually run, and services actually exercised.

## Source and verification notes

This revision incorporates the user's correction of the product purpose and the exact **Sanokei/NarrAItor** repository identity. It supersedes earlier specification/scaffold wording that made software construction the main purpose, treated NarrAItor as unidentified, or excluded `astrochili/narrator` as a useful secondary reference. The conversation and available personality excerpt remain requirements inputs, not evidence that all features already exist.

Public GitHub pages and selected source files were inspected for this revision: iJester's README and transcription/DeepSeek adapters; NarrAItor's project dependencies, LLM/command files and narrator/modding implementation; the third-party narrator documentation; Codex's repository and tool registry; Claude Code's license and documented skills/context behavior; and Cloudflare's skill repository and Cloudflare/Wrangler skill files. This is a focused source review, not a complete audit. A container Git request still failed DNS resolution; no repository checkout, baseline build, or runtime tests are claimed.

The implementation agent must inspect the actual baselines and record the source revisions used before reuse, preferring existing local checkouts where available. For SlopSquash, use the user's existing local project; its exact path and authentication implementation have not been inspected in this environment. Record its commit and any relevant uncommitted source changes without discarding local work. If that checkout is outside the agent's accessible filesystem, report that specific access limitation rather than substituting another project. Pin exact commits for fetched baselines. References below point to the public locations inspected, some on mutable `main`, not fabricated verified commit hashes. SlopSquash's actual authentication source, the complete canonical personality dialogue, and the selected DeepSeek wire-model identifiers remain inputs to verify. The transcribed optional reference “Brock CPU” was not confidently identified; no unrelated repository is substituted for it, and it is not a blocking dependency.

The primary references below distinguish provider/source behavior from Anascummis's own required behavior. Newly added source inspection and this specification revision are dated 2026-09-10; retained platform references came from the preceding specification, with Cloudflare framework, temporary-account, OAuth, and Claude memory guidance rechecked in this revision. External availability and licenses must be checked again when integrating; this document is not a claim that these providers supply the entire product.

[^cf-next]: Cloudflare, “Next.js”: `https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/`.

[^speech]: OpenAI, “File transcription,” especially Whisper prompting and streaming limitations: `https://developers.openai.com/api/docs/guides/speech-to-text`.

[^microphone]: MDN, “MediaDevices: getUserMedia() method,” permission and capture behavior: `https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia`.

[^ink]: inkle, “Writing web-based interactive fiction with ink,” knots, diverts, and choices: `https://www.inklestudios.com/ink/web-tutorial/`. Verify advanced call/return, external-binding, and save-state behavior against the exact compiler/runtime selected for implementation.

[^claude-memory]: Anthropic, “How Claude remembers your project”: `https://code.claude.com/docs/en/memory`.

[^kv]: Cloudflare, “How KV works,” particularly consistency limitations: `https://developers.cloudflare.com/kv/concepts/how-kv-works/`.

[^cf-preview-api]: Cloudflare, “Platforms can now create Temporary Accounts via the Cloudflare API”: `https://developers.cloudflare.com/changelog/post/2026-07-14-temporary-accounts-api/`.

[^cf-preview]: Cloudflare, “Claim deployments (temporary accounts),” credential handling, expiry, and subsequent access: `https://developers.cloudflare.com/workers/platform/claim-deployments/`.

[^cf-oauth]: Cloudflare, “Integrate your OAuth client with Cloudflare”: `https://developers.cloudflare.com/fundamentals/oauth/integrate-with-cloudflare/`.

[^cf-skills]: Cloudflare, public Agent Skills repository and separate skill-folder installation guidance: `https://github.com/cloudflare/skills`. Runtime documentation: `https://developers.cloudflare.com/agents/runtime/execution/agent-skills/`. Pin selected package versions and inspect their resources and licenses before bundling.

[^cookies]: CNIL, “Refusing cookies should be as easy as accepting them”: `https://www.cnil.fr/en/refusing-cookies-should-be-easy-accepting-them-cnil-continues-its-action-and-issues-new-orders`.

[^ijester]: Sanokei, iJester repository/README: `https://github.com/Sanokei/ijester`.

[^ijester-deepseek]: Sanokei, iJester DeepSeek adapter: `https://github.com/Sanokei/ijester/blob/main/src/providers/deepseek.ts`.

[^ijester-whisper]: Sanokei, iJester Workers AI transcription adapter and silence-artifact filtering: `https://github.com/Sanokei/ijester/blob/main/src/providers/workers-ai.ts`.

[^narraitor]: Sanokei, NarrAItor repository and project dependencies: `https://github.com/Sanokei/NarrAItor`; `https://github.com/Sanokei/NarrAItor/blob/main/NarrAItor.csproj`. Additional inspected binding source: `https://github.com/Sanokei/NarrAItor/blob/main/src/LLMBinding.cs`.

[^narraitor-binding]: Sanokei, NarrAItor mod binding and narrator API: `https://github.com/Sanokei/NarrAItor/blob/main/src/Narrator/Modding/NarratorMod.cs`; `https://github.com/Sanokei/NarrAItor/blob/main/src/Narrator/Modding/NarratorAPI.cs`.

[^narraitor-forge]: Sanokei, NarrAItor mod-generation and validation implementation: `https://github.com/Sanokei/NarrAItor/blob/main/src/Narrator/Modding/ModGeneration.cs`.

[^lua-ink]: astrochili, narrator Lua/Ink runtime, API and supported/unsupported features: `https://github.com/astrochili/narrator`.

[^codex]: OpenAI, Codex CLI source and Apache-2.0 license designation: `https://github.com/openai/codex`.

[^codex-registry]: OpenAI, Codex tool registry, registration/exposure and dispatch implementation: `https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/registry.rs`.

[^claude-license]: Anthropic, Claude Code repository license: `https://github.com/anthropics/claude-code/blob/main/LICENSE.md`. Check individual components for any separately applicable terms before reuse.

[^claude-skills]: Anthropic, Claude Code skills documentation: `https://code.claude.com/docs/en/skills`.

[^skills-format]: Agent Skills, format specification: `https://agentskills.io/specification`.

[^skills-client]: Agent Skills, client implementation and discovery/progressive-loading guidance: `https://agentskills.io/client-implementation/adding-skills-support`.

[^cf-skill-files]: Cloudflare, inspected skill entrypoints: `https://github.com/cloudflare/skills/blob/main/skills/cloudflare/SKILL.md`; `https://github.com/cloudflare/skills/blob/main/skills/wrangler/SKILL.md`.
