# Coordinated work checkpoint — 2026-10-29

Repository: `Sanokei/anascummis`. Branch: `codex/long-horizon-checkpoint-20261029`.

- Base: `df70f5ccdb9c3474f04d3f83ad7f60a8f7ecf917`.
- Tested source head: `3a9d642c1e6d8ffc52b4226f040346e27ebce5e0`.
- Source tree: `215b00fc56a6ef5741c11e26f39ba2660bbd5a25`.

This pack is committed after that source head; the source files are identical. Use the pack commit recorded in the accompanying chat to retrieve these private repository files through the connected GitHub tools. Read `manifest.json` for exact paths, byte counts, SHA-256 and validation metadata. No local `/workspace/.cloud-env` link is required to inspect these copies. A public application preview has not been issued.

## Source and measured behavior

The source head contains persistent Goals, Work and Software windows; planner/specialist/acceptance roles; evidence handoffs; interrupted continuation; immutable child revisions; paginated durable activity; explicit window raising; and Next.js 16.4.3/sharp 0.35.5 dependency fixes.

Relevant source paths are `apps/studio/core/{goal-orchestrator,goal-executor,goal-evidence,goal-software,activity-journal,work-journal,software-task}.ts`, `apps/studio/components/{GoalPanel,WorkPanel,SoftwarePanel,ActivityHistory,FloatingPanels}.tsx`, `apps/studio/app/page.tsx`, and the matching tests under `apps/studio/tests`.

Validation at this checkpoint: **183 tests, 0 failures; 1,079 assertions across 17 files**, both TypeScript targets, and the patched production build. See [test output](test-output.txt) and [production build](production-build.txt). The original accepted parent metadata/source/package/lock/ZIP and prior review manifest stayed unchanged. The environment setup draft was read back and remains unchanged; see [verification](environment-draft-verification.json).

The [history receipt](history-lifecycle.json) compares every visible API/DOM sequence and records 184 Goal, 182 Work and 184 Software events, despite summaries retaining 160/160/12. It checks strict pagination, pairing protections, unsent guidance during normal polling, explicit refresh, SIGKILL/restart and page reload. Its controls/progress samples are explicitly labelled fixture data; execution workers are not started for retention testing.

The [execution receipt](goal-execution.json) plans a real website write followed by dependent analysis, interrupts analysis after the write is accepted, then resumes through the Goals window. Project revision stays 1; task attempts are 1 and 2. The [revision receipt](revision-lifecycle.json) creates a distinct child, rejects stale downloads, restarts at its planning checkpoint, then verifies the new heading, retained counter, actual production build and fresh source ZIP while preserving the accepted parent.

Lifecycle inference is scripted. Host source edits, compiler/tests, Chromium behavior, SQLite persistence, downloads and ZIP rebuilding are real. These results do **not** establish native Qwen quality or voice readiness. The [model egress result](model-egress.json) remains HTTP 403. [Normal current first-use capture](current-first-use.json) uses the ordinary server with no model, voice or API mocking and reports `model.ready=false`.

## Small screenshot pack

| View | Desktop | Narrow, 360 px |
| --- | --- | --- |
| Current normal first use, no mocks | [PNG](screenshots/current-first-use-desktop.png) | [PNG](screenshots/current-first-use-narrow.png) |
| Full retained Goal history | [PNG](screenshots/activity-desktop.png) | [PNG](screenshots/activity-narrow.png) |
| Accepted revised child and parent link | [PNG](screenshots/revision-desktop.png) | [PNG](screenshots/revision-narrow.png) |

The [QA helper snapshots](qa) show exactly how the measured fixtures work. They retain this cloud workspace's paths and are provided for source review, not as a portable installer. The tracked project checks run from `apps/studio` with `bun run test`, `bun run typecheck`, and `bun node_modules/next/dist/bin/next build --webpack`; root TypeScript runs with `bun run typecheck` from the repository root. The fixture helpers require isolated data and a free port 3211. Do not run them against user projects.

This checkpoint preserves `main`; no merge, deployment, publication, credentials or services were provisioned.
