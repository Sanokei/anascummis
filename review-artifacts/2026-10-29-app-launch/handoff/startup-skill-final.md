# Anascummis cloud startup and verified limits

Use the existing checkout at `/workspace/anascummis`; do not create a Git worktree. Preserve the user's authorized project changes, accepted source/artifacts, existing source kits, and review receipts. This Linux CPU environment executes generated programs in a trusted local workspace, not an isolation sandbox.

## Initialize every shell

```bash
source /workspace/.cloud-env/anascummis/env.sh
cd /workspace/anascummis/apps/studio
```

The environment helper selects writable caches under `/workspace/.cache` and these installed tools:

- Bun 1.3.14: `/workspace/.cloud-tools/node_modules/.bin/bun`.
- Node 24.19.0: `/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node`.
- Python 3.12.14: `/workspace/anascummis/apps/studio/.venv/bin/python` (`PYTHON_PATH`).
- Chromium: `/usr/bin/chromium` (`STUDIO_BROWSER_EXE`); FFmpeg/FFprobe are in `/usr/bin`.
- Official llama.cpp b11960 CPU server: `/workspace/.cloud-tools/llama/llama-b11960/llama-server` (`LLAMA_SERVER`).

Dependencies are installed. The current studio uses Next 16.4.3 and sharp 0.35.5; preserve the locked dependency/security upgrade. The root type check also uses the installer's ignored local `node_modules/@types/node` symlink. Do not replace these with stale setup versions or bypass verification.

## Native model and ordinary studio startup

The user applied working network access. Official `ggml-org/Qwen3-0.6B-GGUF` weights are installed at `apps/studio/.runtime/Qwen3-0.6B-Q4_0.gguf`. Their verified SHA-256 is:

```text
da2572f16c06133561ce56accaa822216f2391ef4d37fba427801cd6736417d4
```

Do not redownload the installed model, change network settings, disable TLS/checksums, or request credentials speculatively. The native runtime has reported healthy and `/api/status` has reported `model.ready=true`. New snapshots retain files, not running processes: inspect existing owned listeners first, then start missing services in separate long-lived sessions.

Model session:

```bash
source /workspace/.cloud-env/anascummis/env.sh
cd /workspace/anascummis/apps/studio
bun run model:start
```

Studio session:

```bash
source /workspace/.cloud-env/anascummis/env.sh
bash /workspace/.cloud-env/anascummis/start.sh
```

The model script uses CPU inference at `127.0.0.1:8081`, one slot, four threads and a 2048-token context. The studio helper directly execs `bun core/server.ts` with `STUDIO_DEV=0`, serves the existing production build at `http://127.0.0.1:3211`, and records its PID in `/workspace/.cloud-env/anascummis/studio.pid`. Stop only processes you started; a wrapper PID can differ from its child. Do not restart an existing user's model/server or assume saved PIDs prove ownership.

Readiness checks are GETs to `http://127.0.0.1:8081/health` and `http://127.0.0.1:3211/api/status`, plus the ordinary studio page. A health response proves reachability, not task accuracy or voice readiness. Keep both sessions running while checking native workflows. No public deployment/preview or snapshot process restoration is implied.

## Checks and evidence

Run from `apps/studio`, after any frontend build has finished regenerating `.next/types`:

```bash
bun run typecheck
bun run test:local-ai
bun run test:e2e --viewport all --require-model
```

Run the affected unit/integration checks when source changes; use `bun run test` only when a broader regression run is warranted. The test wrapper isolates `STUDIO_DATA` and `STUDIO_TEST_DATA`; use it for suites importing the storage singleton. Native checks use the actual configured transport and model outputs. The four calculation probes passed after clarifying the general arithmetic role: `23+19=42`, `9−14=−5`, `22−30=−8`, and `7−12=−5`. This is bounded evidence, not general reasoning certification.

Actual native source-grounded answering and an isolated exact website title/subtitle edit have worked. The copy proof used real AI delegation/arguments, two saved host revisions, fresh exact-value inspection, and preservation checks. Its receipt is `/workspace/.cloud-env/anascummis/native-copy-handoff/receipt.json`; calculation evidence is under `/workspace/.cloud-env/anascummis/local-ai-readiness/`. Preserve earlier failing receipts as well.

`test:e2e` starts/stops only its own ordinary production server with fresh data and browser sessions. It requires an already built UI and installed Chromium; it does not provision a model/provider or build the app implicitly. Evidence defaults to `.test-data/user-journeys/`. Exit 0 means every attempted user goal passed; exit 1 means failure; exit 2 means a blocked goal. Do not turn `--allow-blocked` diagnostics into an acceptance pass. Coordinate native tests so they do not contend with another agent's one-slot model or long software build.

Final genuine user-goal acceptance passed all 10 cases (five goals on desktop and 360px), 38 independent assertions, with `--require-model` and actual exit 0. Website edits, current-source answers, explicit website/PDF export formats and a source-ZIP counter build were verified through the normal UI. The counter was independently launched and Increment/Reset/reload were exercised. Its source is trusted typed compilation following one native planning call, not proof of arbitrary model-written software.

## Preserve data and honest recovery

Use isolated data for mutating checks. Keep `.data`, fixture databases, pairing keys, private details, generated source and local logs private; review/redact selected diagnostics before sharing. Public research is opt-in. Keep private evidence out of network specialists. Do not publish, deploy, provision external services, or send messages without the user's authorization.

Typing, previews, history and downloads remain usable when AI/voice is unavailable. Use **Type a message**; Enter adds a line, while **Send** or Ctrl/Command+Enter submits. **Check again** refreshes existing model status; **Setup instructions** opens the existing dialog. Voice status follows actual initialization attempts, independently of model health.

Goals retain accepted milestones/evidence and pause uncertain execution for inspection. Software resumes saved checkpoints; completed-build revisions create separate children and preserve accepted parent source/artifacts/downloads. Work **Edit saved request** restores the original project/PDF and exact text for an explicitly submitted new run; it does not resume or replay an old mutation. Unconfirmed submissions preserve drafts: inspect saved work before retrying. Never automatically replay accepted writes, reset accepted work, or weaken acceptance to make a run pass.

## Build and voice limits

Startup uses existing build output. If frontend source changed, deliberately rebuild after checking runtime asset compatibility; do not overwrite old source-kit/download artifacts as a side effect of startup. The stock scene/source-kit build can mutate tracked or published artifacts. The established frontend-only commands are:

```bash
bun build ./components/scene-runtime.ts --outdir ./public --entry-naming scene.js --target browser --minify
bun node_modules/next/dist/bin/next build --webpack
```

Do not run stock `speech:setup` here: the earlier installer warned that it overwrites tracked vendored LavaSR sources. Official digest-verified LavaSR weights are beside the existing worker code; isolated finite 48 kHz enhancer output does not verify Pocket/Kokoro/Whisper, microphone capture, audible replies, or full speech operation. Voice, a physical phone, hosted integrations and Windows executable behavior remain unverified. Browser viewport checks are not physical-device tests.

## Earlier baseline review evidence

- Source branch `codex/user-goal-e2e-20261029`; code checkpoint `94359302f9d43e02f7d6dc381ccba777c4aefd87`, documentation/source-kit checkpoint `bd1f47213f0eff8ce1685a041782910ebd9e73a1`. Exact native report source/runner and served-build fingerprints identify what actually ran.
- Native report: `/workspace/anascummis/apps/studio/.test-data/user-journeys/native-final-gated/report.html` and `post-validation.json`. Ten goals passed with the real resident model; earlier blocked/failed runs are kept separately.
- Four real inference checks passed in `/workspace/.cloud-env/anascummis/local-ai-readiness/native-check-final.json`. The initial bad arithmetic/source uncertainty and wrong specialist/Reset failures remain preserved rather than relabelled as passes.
- Final production build and Studio TypeScript passed. Affected checks: 95 tests/515 assertions in 11 files, plus one counter-contract test/3 assertions; these are distinct from real native browser goals.
- That earlier checkpoint supplied source kit `e3e76d87cf900de9`; retain it as a frozen historical artifact. The latest software-goals source kit is identified below. The old frozen source kit and all accepted prior parent artifacts remain preserved. Model weights, databases, credentials and caches are excluded from source distribution.
- Additive repository review pack: `review-artifacts/2026-10-29-user-goal-e2e/`; inspect its README for exact pins, screenshots, receipts and capability limits. No main promotion or public deployment is implied.

This startup skill replaces stale setup observations only. Installer/network settings are preserved; publishing another environment snapshot remains a user action. Files and verified weights can persist, while model and Studio processes must be started again when absent.


## Continuation: cached native service and software user goals

A verified model file is not a running service. On 2026-10-29 a continuation found the old model launcher/server defunct while Studio remained live; its prior termination cause was not established. Normal cached startup restored genuine inference without another model download. Inspect current listeners/process command lines and local health before starting anything; do not rely on an old PID, and do not start a duplicate while a service is loading.

If no model service is listening on 8081 and no existing launcher is loading it, this separately detached session pattern was executed successfully in the prepared machine (never use it to replace a healthy service):

```sh
source /workspace/.cloud-env/anascummis/env.sh
python - <<'PY'
from pathlib import Path
import subprocess
logs=Path('/workspace/.cloud-env/anascummis/services')
logs.mkdir(parents=True,exist_ok=True)
with (logs/'model.log').open('ab') as output:
    child=subprocess.Popen(['bash','-lc','source /workspace/.cloud-env/anascummis/env.sh\nexec bun run model:start'],cwd='/workspace/anascummis/apps/studio',stdout=output,stderr=subprocess.STDOUT,start_new_session=True)
    print('Model launcher PID:',child.pid)
PY
```

Then verify local 8081 health, Studio 3211 /api/status model.ready, and one actual application inference check (`cd /workspace/anascummis/apps/studio && bun run test:local-ai`). A loading/503 response calls for bounded diagnosis/wait, not another launcher or download. Model/startup failure must retain its real exit status. Keep Studio in its own session and reuse it when already healthy. Publication/snapshots retain files, not a promise that these processes survive.

The software goal suite now tests the ordinary composer, real generated output, actual downloaded-source extraction/build/package start, persistent task lists and immutable heading revisions; the counter suite checks real phone controls and keyboard feedback. Use the affected journey and a fresh output directory. Scripted host tests do not establish native model quality, and an E2E-owned application server is not an ordinary in-product launch action. Reuse installed matching dependencies for the documented bounded source checks; do not describe those as a fresh online installation or Windows/macOS verification.


## Earlier verified software-goals delivery

The supported software capability now includes an exact typed persistent task-list request, immutable heading-only child revisions, comfortable counter controls, visible package-start instructions, and explicit retry of failed saved validation. Tested runtime/runner source: `345b82bcc8dee4591bf93c98029624667185a0b9`. Delivery/documentation source: `20b7f5c423c4e1fb7e63c8e016605f7ad0ba8411` on `codex/task-list-e2e-20261029`; the delta from the tested runtime is four documentation files only.

Seven affected browser cases passed: four fresh real-local-model task-list/counter cases at desktop/360px, one actual copied failed-checkpoint recovery, and two read-only window-routing cases. These are 36 goal assertions, plus 63 affected unit/integration tests (367 assertions), both TypeScript targets and the production UI build. Recovery reused the exact saved source/revision/model-call count; it is not fresh inference. The old generic unbounded worker's 'Inspect a target source file first' failure remains an observed limitation. Bounded typed recipe compilation does not demonstrate arbitrary model-written application quality.

Current Download kit: version `3298a9e9adb589b2d84f2111af36120eee539e6d044ccda1045d3af69edd28b9`, filename `anascummis-studio-3298a9e9adb589b2.zip`, archive SHA-256 `926fc41c9cce47e30ba659e05dbdee1f847ec513f8073bd30607b9a608a2ff16`, 237 source files, 1,648,533 bytes, clean source `20b7f5c423c4e1fb7e63c8e016605f7ad0ba8411`. Existing dependencies were reused for generated-app extraction/build/package-start checks; this is not a fresh online installation or native Windows/macOS pass. Preserve the older frozen kits. Read the current `out/opensource/manifest.json` before distributing a future build.

The normal Studio backend was deliberately updated only after confirming no active jobs and preserves its existing runtime environment and saved API records. The actual local Qwen process remained healthy. PID numbers are historical observations, not startup ownership proof. No environment publication, main promotion or public deployment was performed.

Review: `review-artifacts/2026-10-29-software-goals/` and `apps/studio/.test-data/user-journeys/task-list-acceptance-post-validation.json`. That checkpoint identified in-window launch as the next gap. The newer launch increment below now implements a bounded trusted-client preview; manual instructions remain for other apps. Voice and physical-device behavior remain unverified.


## Latest verified checked-app launch

Current branch: `codex/trusted-app-launch-20261029`. Tested runtime and delivery source: `ade3e43479654e60415876ba681d965c5a8ff296`. Earlier implementation `2318ced4`, layout/history `32bbce68`, documentation `37044f05`, frozen `62c81b4e`/`20b7f5c4`, older kits and failure receipts remain preserved. Main was not promoted.

Local Software work now offers explicit Start app / Stop running app for exact recognized, completed counter and collection client pages. Preparation verifies the accepted ZIP, known compiler source, current checks and matching installed React dependencies, then derives a separate runtime manifest. A fixed asset worker runs that accepted client page; it does not run a packaged Next server or arbitrary model-written server code. It uses Bun `--no-env-file --no-install`, a minimal environment, fixed in-memory assets, strict separate-origin sandbox/CSP, credential stripping before asset handling, nonce/identity IPC readiness and disconnect cleanup. Missing/changed source, dependencies, runtime or occupied saved ports fail visibly without installation, port changes or unknown-process signals. This is trusted local execution, not hostile-code or OS isolation.

Mount/reopen/poll/reconnect does not Start. Closing Software work leaves its owned process running but reloads the client page on reopen: saved items survive; unsent app input and counter memory do not. Stop awaits the owned exit. Host restart leaves apps stopped/interrupted; only explicit Start reuses the durable lineage address. Reconnect to Studio uses read-only ordinary-page/status requests and preserves unsent Studio text without navigation. Keep an already-open frame/input during temporary status errors, but disable Reload until ownership/session and action delivery are verified. Compatible child use is explicit Stop then Start at the same address/key. Accepted records/source/downloads remain unchanged. Live builds stay discoverable beyond the recent 20; at most two lineages run.

Final ordinary-server launch suite: four cases, 44 outcome assertions, exit 0 at clean `ade3e434`, plus two read-only navigation cases. It covers desktop/360px and actual 360×420 resize/interactions, Start/Stop, graceful/forced host restart, old-tab reconnect, compatible child data, source identity, collision refusal and unconfirmed delivery. These cases use copied, previously native-generated accepted work and perform no fresh inference. The corrected phone frame is 316px wide with reachable opaque controls. Package/process/state/component proofs are separately labelled. Backend gates: 77 tests / 345 assertions in 10 files, both TypeScript targets, explicit strict worker types and production build; the final client-only Reload guard has its own frontend gates and real four-case rerun. Actual resident Qwen smoke also passed again: 42, -5, -8, -5. Voice, physical handsets, Windows/macOS and general model quality remain unverified. Some orphaned exited PIDs are zombies; report no running listener rather than claiming complete reaping.

Current Download kit: `anascummis-studio-c9c84ba6a1c9844a.zip`; version `c9c84ba6a1c9844a5e252cd926ce5cc20c827bfdb91b925b76b5cb39207e0326`; SHA-256 `d5ab598227fe7e1674c2751db4704b6589495f7ffab5a0bbd622130f977a7bec`; 247 source files / 1,832,950 bytes; clean source `ade3e43479654e60415876ba681d965c5a8ff296`. All payload hashes and current source files, own-origin HTTP and real browser downloads were checked. No fresh online install or repeated clean Studio extraction/start matrix is claimed. Preserve the frozen earlier kits and original failures.

Review: `review-artifacts/2026-10-29-app-launch/`, `apps/studio/.test-data/user-journeys/app-launch-guard-final-ade3e43/report.json` and `/workspace/.cloud-env/anascummis/app-launch/`. The normal server was updated only when idle with saved API records/environment unchanged; its native model remained running. Final client assets/kit were refreshed while its byte-identical backend stayed live. Start missing services with the cached commands above, never auto-start app previews or blindly use saved PIDs. No new environment publication, public deployment or main promotion occurred. Files and instructions can persist while running processes need supported startup after restoration. The next target is a genuine native research→brief/document handoff with a usable artifact and interrupted continuation; it remains unproven.
