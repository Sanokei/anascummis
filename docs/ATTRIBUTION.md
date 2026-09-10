# Attribution and baseline verification

Recorded 2026-09-10 by the implementation agent.

## What was actually inspected in this environment

| Baseline | Location inspected | What was verified | What was reused |
| --- | --- | --- | --- |
| SlopSquash (the user's own project) | `C:\Users\wkeif\Desktop\slopsquash` | Only a `.dev.vars` file is present. It is not a source checkout, and it is not a git repository. | The **configuration pattern only**: which providers the user already runs. Variable *names* were read; no value was read, copied, or stored. |
| `Sanokei/iJester` | Not fetched | — | Separation of concerns only, from the specification's description. |
| `Sanokei/NarrAItor` | Not fetched | — | Adapted ideas only, from the specification's description. |
| `astrochili/narrator` | Not fetched | — | Nothing. See below. |
| `openai/codex` | Not fetched | — | Nothing copied. |
| `anthropics/claude-code` | Not fetched | — | Nothing copied. |
| `cloudflare/skills` | Not fetched | — | Nothing copied. |

**No repository was cloned and no commit was pinned.** Outbound git and network access were not
exercised for baseline retrieval during this build. Every mechanism below was implemented
independently against the documented interface described in the specification, which is the
route the specification explicitly permits where a licence does not allow reuse.

This is a limitation, not a claim of independence-by-preference. If those checkouts become
available, the reuse decisions below should be revisited and the exact commits recorded here.

## SlopSquash: the specific access limitation

The specification requires inspecting the user's local SlopSquash checkout for the
authentication and social-login baseline, and says to report the access limitation rather than
substitute a similarly named project.

What exists locally is `C:\Users\wkeif\Desktop\slopsquash\.dev.vars` and, separately,
`C:\Users\wkeif\Downloads\SlopSquash.zip`. The zip is a design-canvas export containing HTML,
images and screenshots. Neither contains authentication source, tests, or callback handling.
`C:\Users\wkeif\Documents\GitHub\SlopVanish` exists and is **not** used: it is a similarly named
project, and the specification forbids substituting one.

What was taken from `.dev.vars` is the set of variable names, which established that the user
already runs Google and GitHub social login, DeepSeek with a configurable base URL and model,
and OpenAI. Anascummis mirrors those names so the two projects stay operationally consistent.
No secret value was read, copied into source, or written to any file.

The authentication implementation here is therefore original: PKCE where the provider supports
it, checked OAuth `state`, a redirect allowlist, host-side encrypted token storage, and
deliberate account linking. It was not derived from SlopSquash source, because none was
readable.

## `astrochili/narrator`

Not used. The specification correctly flags that its Ink support is partial and that its source
parsing depends on LPeg, which has no tested path into a standard Worker. Ink runtime and
compilation here use `inkjs`, which is a JavaScript implementation that runs on `workerd`
without a native dependency, and whose compiler output is validated by the harness rather than
trusted.

## Third-party dependencies

| Package | Version | Licence | Why |
| --- | --- | --- | --- |
| `inkjs` | 2.3.2 | MIT | Real Ink compilation and runtime, including `Compiler`. |
| `fengari` | 0.1.4 | MIT | Lua 5.4 in JavaScript. Chosen over a WASM Lua because `lua_sethook` gives a genuine instruction-count ceiling inside the VM. |
| `hono` | 4.6.14 | MIT | Router. |
| `react`, `react-dom` | 18.3.1 | MIT | Interface. |
| `tailwindcss` | 4.0.0 | MIT | Styling. |
| `vite`, `@vitejs/plugin-react` | 6.0.7 / 4.3.4 | MIT | Build. |
| `wrangler` | 4.131.0 | MIT or Apache-2.0 | Deployment. |
| `@cloudflare/vitest-pool-workers` | 0.8.71 | MIT or Apache-2.0 | Tests inside `workerd`. |

Licence texts ship with each package under `node_modules`. Nothing in this repository vendors a
copy of third-party source.

## Personality material

`personality.md` and the script outline are the user's own authored material, supplied as
requirements input. Authored lines are stored as versioned reference scenes and reused verbatim
where the situation and intent recur. They are not paraphrased to sound more conversational, and
no missing canonical exchange was invented to fill a gap in the supplied excerpt.
