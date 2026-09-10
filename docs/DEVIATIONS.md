# Deviations from the specification

Each entry states what the specification asked for, what was built, and why. Nothing here is a
silent substitution.

## 1. Vite and React instead of the Next.js surface through vinext

**Specification:** "the Next.js application API surface through vinext/Vite".

**Built:** Vite 6 with React 18, built to static assets and served by the Worker through the
`assets` binding, with `run_worker_first` set to `true` so the Access gate covers static assets
as well as the API. The Worker itself is a Hono router.

**Why:** The specification also requires testing the selected vinext features on Workers and
notes Cloudflare's own beta and compatibility qualifications. The rest of the product depends on
Durable Object generation fences, D1 transactions, streaming responses, and WASM-free Lua inside
`workerd`. Building all of that on a beta framework wrapper adds a failure surface that would not
have improved the delivered product.

Every other element of the required stack is unchanged: Bun for package management and tooling,
TypeScript, React, Tailwind, and Cloudflare Workers configured and deployed through Wrangler.

**What this costs:** no file-system routing and no React Server Components. The application is a
single-page client against a documented JSON API, which is what the interface actually needs.

## 2. Fengari rather than a WASM Lua runtime

**Specification:** a "genuinely resource-bounded, interruptible isolation boundary", explicitly
noting that removing standard-library names or wrapping a blocked interpreter in a JavaScript
timeout is insufficient.

**Built:** Fengari, with `lua_sethook` on `LUA_MASKCOUNT` firing every 250 VM instructions.

**Why:** this is the stronger option for the requirement, not a compromise. The hook runs inside
the VM, so `while true do end` is interrupted at a known instruction count rather than left to
run until an external timer that can never fire on a blocked thread. A WASM Lua would have given
memory isolation but no in-VM instruction ceiling without a custom build.

**What this costs:** Fengari does not enforce a hard memory ceiling. Value size, node count, and
nesting depth are bounded at every boundary crossing instead, and the Worker's own memory limit
is the outer bound. This is a real gap and is recorded as one.

## 3. Asynchronous host bindings use a Lua coroutine

**Specification:** requires an explicit host yield/resume protocol for Ink. It does not describe
the Lua binding protocol in the same detail.

**Built:** the same shape for Lua. `run()` executes inside a coroutine; `host.<name>(...)` yields
a request, the host resolves it asynchronously, then resumes with exactly one value.

**Why:** Fengari is synchronous. Without this, no generated capability could retrieve anything
based on a computed value, which would have made the Forge close to useless. This keeps Lua as
leaf execution: it still cannot call the model, reach another capability, or load code.

## 4. Temporary Cloudflare preview accounts are not provisioned

**Specification:** guests can request a temporary Cloudflare preview account through the
documented provisioning interface.

**Built:** the interface reports this as unavailable, with the specific reason.

**Why:** the deploying account's API token was not verified to carry the temporary-accounts
scope, and the specification forbids fabricating a preview or creating accounts repeatedly to
evade limits. The adapter and its contract exist; the path returns `missing-credential` with the
scope it would need. Local and session work is preserved either way, which is the behaviour the
specification requires when provisioning is unavailable.

## 5. Provider coverage

**DeepSeek** is the configured conversational route and is used when `DEEPSEEK_API_KEY` is set.
No key was available during this build, so the deployed instance falls back to the bound Workers
AI chat model. The fallback is reported in the interface rather than hidden, and the wire model
identifier is configuration in both cases.

**Whisper** runs through Workers AI, which is bound and functional. The OpenAI path exists for
deployments that prefer it and sends complete bounded chunks, because hosted `whisper-1` does
not support file streaming.

**Search** uses Brave when `BRAVE_SEARCH_KEY` is set and a keyless HTML endpoint otherwise. The
keyless path is fragile by nature: when its markup stops parsing, it returns
`upstream-error` saying no sources were retrieved, rather than an invented result set.

## 6. Cloudflare Access gates the whole deployment

**Specification:** guest use is supported, with transient context and no durable memory.

**Built:** guest support exists in full and is exercised by the code, but the deployment is
closed behind Cloudflare Access at the operator's request. Nobody reaches the site without
satisfying the Access policy, so in practice there are currently no guests.

**Why:** the operator asked for it while the product is unfinished. This is a deployment
decision, not a change to the product: setting `ACCESS_REQUIRED` to `false` restores the
guest path without touching any other code.

**What this costs:** the health check is behind Access too, because the Access policy covers
the hostname rather than a path. An uptime monitor would need a bypass policy for `/healthz`.

## 7. Lab review needs a capable vision model, and the cheap one is not

**Requested:** the assistant should do its own visual QA, looking at what it
generated or at a screenshot it took.

**Built:** `image.generate`, `render.screenshot`, `lab.open`, `lab.review` and
`lab.close`, each a registry capability passing the ordinary dispatcher gate.

**The measurement that shaped it.** Two Workers AI vision models were tested on
2026-09-10 against a rendered page headed "Anascummis", carrying a paragraph and
a button labelled Stop:

| Model | Result |
| --- | --- |
| `@cf/llava-hf/llava-1.5-7b-hf` | Answered, and was wrong. Reported "a single word 'text' on a black background". |
| `@cf/meta/llama-3.2-11b-vision-instruct` | Capable, but refuses until the account accepts Meta's community licence. |

So neither is wired in as a default. A model that is confidently wrong is worse
for QA than one that is absent, because its verdict reads exactly like a correct
one. Accepting a model licence is the operator's decision, not this code's, so
that was not clicked through either.

`WORKERS_AI_VISION_MODEL` is empty by default and exists for an operator who has
made that choice. Otherwise review needs `DEEPSEEK_API_KEY`, whose vision model
is verified multimodal.

**A review verdict is not a test result.** The specification is explicit that a
model saying it approves is not validation, and reviewing your own output is
exactly where that fails. So a verdict travels with a caveat that cannot be
dropped by a caller reading only `allMet`, a criterion the reviewer did not
answer is recorded `unverifiable` rather than met, and nothing in the product
gates a consequential action on a review passing.

**Screenshots need a token the operator creates.** Browser Rendering works on
this account and is verified, but it is reached through the REST API, which
needs a credential. The deploy token was not reused: it can create and delete
every resource on the account, and a rendering credential should only be able to
render. Without `BROWSER_RENDERING_TOKEN`, screenshots report
`missing-credential` naming the scope they need.

## 8. What is not implemented

These are absent, not stubbed as if working:

- **Streaming token output.** Responses are delivered per turn. The client renders progressively
  but the Worker does not stream partial model tokens.
- **Real audio latency measurement at p50/p95.** The measurement points are instrumented and
  recorded, but no documented-conditions benchmark run was performed, so no latency figure is
  claimed.
- **Cloudflare OAuth against a registered client.** The flow is implemented; registering an
  OAuth client is an account action the user must take. Without
  `CLOUDFLARE_OAUTH_CLIENT_ID`, Connect Cloudflare reports itself unavailable.
- **Public skill-source search.** Discovery searches the bundled and staged catalogue. Fetching
  unknown packages from a remote catalogue is gated behind a policy approval that has no
  configured approver, so it reports the block rather than staging silently.
