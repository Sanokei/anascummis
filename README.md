# Anascummis

A conversational-first assistant with an authored personality, running on Cloudflare Workers.

You talk to it. It keeps the thread, finds relevant information and skills, and does permitted
work without turning the exchange into a menu. Voice is a primary interface; text and clickable
choices are fully usable alternatives. Ordinary conversation is a valid outcome — it does not
invent a software project, deploy a Worker, or install a skill because you started talking.

Software creation is a supporting capability, not the point. When an installed tool or skill can
do the job, it uses that. When a capability is genuinely missing, it can build and validate a
bounded extension instead of claiming the job was done.

---

## How it fits together

```
speech or typed text
  → Whisper (when audio is used)
  → choice resolver
  → skill activation, when a skill is actually useful
  → validated Ink story or open-conversation continuation
  → host confirmation and authorisation gate
  → capability registry
  → bounded Lua sandbox and granted host bindings
  → structured result
  → Ink continuation
  → visible response, optional spoken output
```

The governing rule is that no layer can authorise itself:

| Layer | Supplies | Cannot do |
| --- | --- | --- |
| Conversation | Intent | Authorise an action |
| Skills | Relevant procedures | Grant a permission or call an arbitrary Lua path |
| Ink | Composition and navigation | Contain an unresolved action reference |
| Lua | Bounded leaf computation | Call the model, spawn an agent, or load code |
| Host and registry | Authorisation and execution | Be widened by anything above it |

### Components

- **Ink Story Harness** — compiles candidate stories with the real Ink compiler, then checks
  every action reference against a registry contract snapshot. No executable story version may
  contain an unresolved action reference, including on a branch nobody selected.
- **Capability registry** — the authoritative executable catalogue. Each entry carries an
  immutable version and source hash, an input/output contract, granted permissions, a risk
  class, resource budgets, and validation evidence. Execution needs an installed, non-revoked
  version plus current session authorisation.
- **Lua sandbox** — Fengari with a fresh state per call, denied globals, an instruction-count
  debug hook that interrupts a spinning loop, and a coroutine yield/resume protocol so host
  bindings can be asynchronous without blocking the VM.
- **Story Function Forge** — checks for an existing compatible capability first. When new Lua is
  genuinely needed, it requires a specification, a least-privilege manifest, an implementation,
  tests, and a reviewable validation report before installation.
- **Skill Discovery and Execution Harness** — the Agent Skills `SKILL.md` format with staged
  loading. Catalogue metadata first, instructions on activation, supporting files as needed.
- **Memory Manager** — layered context: global guidance, user preferences, project context,
  topic memories, immediate conversation state. Conversation history is an immutable checkpoint
  DAG with one active HEAD per session.
- **Session coordinator** — a Durable Object holding the live HEAD, generation fences, and
  action ordering. KV is a short-lived cache, never a synchronisation authority.

---

## Requirements

| Tool | Version used here |
| --- | --- |
| Bun | 1.3.0 |
| Node | 22.x (for Wrangler) |
| Wrangler | 4.131.0 |
| A Cloudflare account | Workers, D1, KV, Durable Objects, Workers AI |

---

## Installation

```bash
git clone https://github.com/Sanokei/anascummis.git
cd anascummis
bun install
```

### Create the Cloudflare resources

```bash
bunx wrangler d1 create anascummis-db
```

```bash
bunx wrangler kv namespace create CACHE
```

Copy the returned `database_id` and KV `id` into `wrangler.jsonc`, replacing
`PLACEHOLDER_D1_ID` and `PLACEHOLDER_KV_ID`.

### Apply the schema

```bash
bunx wrangler d1 migrations apply anascummis-db --local
```

```bash
bunx wrangler d1 migrations apply anascummis-db --remote
```

### Configure secrets

Copy the example file and fill in what you have.

```bash
cp .dev.vars.example .dev.vars
```

Every secret is optional. A missing provider produces an honest unavailable state rather than a
silent substitution. `SESSION_SECRET` is the exception: production refuses to start without it,
because it signs sessions and encrypts third-party tokens at rest.

| Secret | Effect when absent |
| --- | --- |
| `SESSION_SECRET` | Required. Generate with `openssl rand -base64 48`. |
| `DEEPSEEK_API_KEY` | Falls back to the bound Workers AI chat model. |
| `OPENAI_API_KEY` | Transcription falls back to Workers AI Whisper. |
| `BRAVE_SEARCH_KEY` | Search falls back to a keyless HTML endpoint. |
| `GOOGLE_CLIENT_ID` / `_SECRET` | Google sign-in is hidden. |
| `GITHUB_CLIENT_ID` / `_SECRET` | GitHub sign-in is hidden. |
| `CLOUDFLARE_OAUTH_CLIENT_ID` / `_SECRET` | Connect Cloudflare is unavailable. |

For production, set each one as a real secret rather than a var:

```bash
bunx wrangler secret put SESSION_SECRET
```

---

## Running it

Local development, with the Vite dev server proxying `/api` to a local Worker:

```bash
bun run dev
```

The Worker side, against local D1 and KV:

```bash
bunx wrangler dev
```

Build and preview exactly what deploys:

```bash
bun run preview
```

Deploy:

```bash
bun run deploy
```

---

## Tests

```bash
bun run test
```

Tests run inside `workerd` through `@cloudflare/vitest-pool-workers`, so D1, KV, and Durable
Object behaviour is exercised against the real runtime rather than a mock. Coverage is
deliberately weighted toward the failure paths: cancellation, stale worker results, budget
exhaustion, revoked capabilities, denied tools, prompt injection in retrieved text, consent
refusal, and speech false positives.

```bash
bun run typecheck
```

---

## Repository layout

```
migrations/          D1 schema
skills/              Bundled SKILL.md packages
stories/             Ink sources, versioned and immutable
capabilities/        Seed Lua capabilities and manifests
src/shared/          Contracts shared by Worker and client
src/worker/
  auth/              OAuth, sessions, CSRF, PKCE, account linking
  ink/               Ink runtime, harness, choice resolver, name recognition
  lua/               Sandbox and Story Function Forge
  registry/          Capability registry, schemas, native adapters
  skills/            Discovery, staging, execution harness
  memory/            Layered context and the checkpoint DAG
  agents/            Scheduler and the elastic job pool
  providers/         DeepSeek, Whisper, search, retrieval
  policy/            Budgets, permissions, confirmation
  do/                Session coordinator Durable Object
src/client/          React interface
tests/               Vitest suites
docs/                Attribution, deviations, verification notes
```

---

## Attribution and reuse

Baselines inspected and adapted are recorded in [docs/ATTRIBUTION.md](docs/ATTRIBUTION.md), with
the licence that governs each one. Deviations from the specification, and the reason for each,
are recorded in [docs/DEVIATIONS.md](docs/DEVIATIONS.md).

Public visibility is not a licence to redistribute code. Where a baseline's licence does not
permit reuse, the documented interface was implemented independently instead of copied.
