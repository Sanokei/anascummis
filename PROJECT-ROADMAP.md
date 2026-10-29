# Working toward a useful long-horizon assistant

The project is unfinished. A passing small benchmark demonstrates those specific workflows, not general competence. Progress must be measured against a person's requested result, with retained evidence and a usable recovery path.

## Current baseline

Real local Qwen inference is installed and running in the prepared environment. The source-pinned [native user-goal checkpoint](review-artifacts/2026-10-29-user-goal-e2e/README.md) verifies five goals on desktop and narrow viewports: discovering actions, exact website copy, correct website/PDF exports, one cited document answer, and a bounded counter application. The counter uses a trusted typed compiler; it does not establish arbitrary software generation. Voice and physical-device behavior remain unverified.

## Active: read the evidence needed by the actual question

**Observed P1:** asking where Fetch tests live and where browser results are displayed produced an accepted, completed answer with neither location. The app had retained all 4,815 source characters but fed only 0–800 to inference. Both requested facts were present around positions 1,768–2,200. The native answer admitted its information gap; reviewers still accepted it. This is false completion, not merely a small-context inconvenience.

Acceptance for the current increment:

- Scan retained public-source text locally for relevant passages, stay within the real inference budget, and persist the exact question, range offsets/hashes and selection rationale before generation. Do not imply the model read the whole document.
- Require both correct locations and supporting later-document quotations from real inference. A source-insufficient result stays unfinished; exact citation matching alone cannot certify that a question was answered.
- Show actual reading selections, progress, answer/review state and inspection actions in the existing Goals window. Keep selection/source identity across close, reload, cancellation and interruption.
- Ask a different question from the same saved sources through an explicit new linked goal. Reuse verified copies without refetching, preserve the parent's accepted answer, and keep draft conflicts visible.
- Add real user-goal journeys for the later-document answer, saved-source follow-up and honest insufficient-evidence recovery. Preserve the original failed native run for comparison.

Owner reproduction: `/workspace/.cloud-env/anascummis/later-source-before/native-Zo9600/receipt.json`. The source is the public WHATWG Fetch repository README, content SHA-256 `d484144421db3f758ef98fe5bf13c3dbe1e07a357033af5288298ea0f4f2ceaa`. Code baseline: `678264ac5fd075921ef7e780f333c00432857423`.

## Remaining capability milestones

| Milestone | Current evidence/gap | User-result acceptance |
| --- | --- | --- |
| Software beyond the counter recipe | The original real general-worker counter attempt omitted Reset/changed the heading and stalled reading source. A typed counter recipe fixed that class only. | Build a task-list app with add/remove/persistence; independently run the delivered app and downloaded source, then revise it without losing the accepted parent. |
| Useful native document editing | Backend PDF edits/rendering and simple import/export work; a multi-page native edit journey is absent. | Edit a supplied multi-page document, preserve unrelated content/layout, inspect actual pages and download the correct revised file. |
| Cross-specialist work | Individual capabilities and bounded evidence handoffs exist; realistic research→draft→artifact work is not broadly proven. | Use cited research to produce a requested brief or website section, with source provenance and acceptance for every dependent step. |
| Real long-job recovery | Earlier host-flow interruption/revision tests include scripted inference; current native benchmark mainly covers close/reload. | Interrupt a genuine multi-stage native job, restart, inspect exactly what finished, and explicitly continue without repeating accepted writes. |
| Voice as a usable primary interface | Native model readiness is established; microphone, transcription and complete spoken replies are not. | A real spoken goal reaches the correct artifact, supports interruption and recovery, and offers typing when voice fails. |
| Capability extensions | Tools are host-registered; reading source or proposing a harness is not installing a verified capability. | Add a bounded capability with dependencies, permissions, useful native acceptance tests and visible provenance before activation. |

These are testable gaps, not completed features or delivery promises. Pick the next increment from actual user failures after the active milestone is verified. Keep this file updated with evidence and preserve limits rather than replacing hard tasks with easier benchmark goals.
