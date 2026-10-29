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

## Current review evidence

- Source branch `codex/user-goal-e2e-20261029`; code checkpoint `94359302f9d43e02f7d6dc381ccba777c4aefd87`, documentation/source-kit checkpoint `bd1f47213f0eff8ce1685a041782910ebd9e73a1`. Exact native report source/runner and served-build fingerprints identify what actually ran.
- Native report: `/workspace/anascummis/apps/studio/.test-data/user-journeys/native-final-gated/report.html` and `post-validation.json`. Ten goals passed with the real resident model; earlier blocked/failed runs are kept separately.
- Four real inference checks passed in `/workspace/.cloud-env/anascummis/local-ai-readiness/native-check-final.json`. The initial bad arithmetic/source uncertainty and wrong specialist/Reset failures remain preserved rather than relabelled as passes.
- Final production build and Studio TypeScript passed. Affected checks: 95 tests/515 assertions in 11 files, plus one counter-contract test/3 assertions; these are distinct from real native browser goals.
- Download now supplies source kit `e3e76d87cf900de9` from the documented checkpoint. The old frozen source kit and all accepted prior parent artifacts remain preserved. Model weights, databases, credentials and caches are excluded from source distribution.
- Additive repository review pack: `review-artifacts/2026-10-29-user-goal-e2e/`; inspect its README for exact pins, screenshots, receipts and capability limits. No main promotion or public deployment is implied.

This startup skill replaces stale setup observations only. Installer/network settings are preserved; publishing another environment snapshot remains a user action. Files and verified weights can persist, while model and Studio processes must be started again when absent.
