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
- **Design harness** — a drawing or a 3D scene is authored as *source*, and the source is the
  artifact: it is measured, compiled to an image or a GLB, and kept verbatim so a revision can
  be re-checked later against a changed checker. Acceptance criteria are compiled into host
  checks that run against the source or the rendered pixels, and a vision model's view is
  recorded separately and is never by itself the reason a criterion reads `met`. A scene renders
  itself inside the Worker, so its pixel checks run without a browser; a drawing needs one, and
  says so rather than quietly passing when none is configured.
- **Skill Discovery and Execution Harness** — the Agent Skills `SKILL.md` format with staged
  loading. Catalogue metadata first, instructions on activation, supporting files as needed.
- **Memory Manager** — layered context: global guidance, user preferences, project context,
  topic memories, immediate conversation state. Conversation history is an immutable checkpoint
  DAG with one active HEAD per session.
- **Session coordinator** — a Durable Object holding the live HEAD, generation fences, and
  action ordering. KV is a short-lived cache, never a synchronisation authority.

---

## Access

**This deployment is closed.** Cloudflare Access sits in front of `anascummis.com`
and is the only way in. Reaching the site at all requires an identity that satisfies the
Access policy; there is no public entry point and no guest path from the internet.

The gate is enforced twice, deliberately:

1. **At the edge.** Cloudflare Access intercepts before the Worker runs. An unauthenticated
   request is redirected to the Access login and never reaches this code.
2. **In the Worker.** Every request re-verifies the forwarded JWT: the RS256 signature
   against the team's published keys, the audience against this application's own tag, the
   issuer, and the expiry. The token's own `alg` field is not trusted, so `alg: none` and
   HMAC-confusion attempts are refused rather than parsed.

The second check is not redundant. A request that reached the Worker by some other path
would carry whatever header it liked, and `run_worker_first` is `true` so the gate covers
static assets as well as the API. If the edge policy were ever removed, the Worker would
still serve nothing.

`ACCESS_REQUIRED` defaults to on and **fails closed**: with Access unconfigured, or a token
that does not verify, nothing is served at all.

### Roles

Access answers whether someone may reach the Worker. A role answers what they can do once
inside, which is a separate question.

| Role | Granted by |
| --- | --- |
| `super-admin` | Membership of `SUPER_ADMIN_EMAILS`, checked on every sign-in |
| `admin` | Assigned directly in the database |
| `member` | Everyone else who satisfies the Access policy |

The super-admin list is the authority, so removing an address demotes that account on its
next sign-in rather than leaving a stale administrator. A role is never inferred from the
email domain, which means widening the Access policy cannot accidentally mint admins.

Service tokens are refused. They authenticate a machine and carry no email, and this
product attaches an account and a role to a person.

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

### Set up Cloudflare Access

Create a self-hosted Access application for the hostname, add a policy naming who may enter,
then put the team domain and the application's audience tag into `wrangler.jsonc`. Neither is
a secret: the team domain is public and the audience tag identifies the application without
authorising anything by itself.

```bash
bunx wrangler deploy --dry-run
```

Confirm `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` are listed before deploying for real.

### Create the Cloudflare resources

```bash
bunx wrangler d1 create anascummis-db
```

```bash
bunx wrangler kv namespace create CACHE
```

```bash
bunx wrangler r2 bucket create anascummis-vision
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
| `SUPER_ADMIN_EMAILS` | Nobody is a super-admin. Kept as a secret so no address is committed. |

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
