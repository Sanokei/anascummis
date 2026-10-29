# Working toward a useful long-horizon assistant

The project is unfinished. A passing small benchmark demonstrates those specific workflows, not general competence. Progress must be measured against a person's requested result, with retained evidence and a usable recovery path.

## Current baseline

Real local Qwen inference is installed and running in the prepared environment. The source-pinned [native user-goal checkpoint](review-artifacts/2026-10-29-user-goal-e2e/README.md) verifies five goals on desktop and narrow viewports: discovering actions, exact website copy, correct website/PDF exports, one cited document answer, and a bounded counter application. The counter uses a trusted typed compiler; it does not establish arbitrary software generation. Voice and physical-device behavior remain unverified.

## Verified research increment: read the evidence needed by the actual question

**Observed P1:** asking where Fetch tests live and where browser results are displayed produced an accepted, completed answer with neither location. The app had retained all 4,815 source characters but fed only 0–800 to inference. Both requested facts were present around positions 1,768–2,200. The native answer admitted its information gap; reviewers still accepted it. This is false completion, not merely a small-context inconvenience.

The bounded increment passed genuine Qwen desktop/narrow source, linked-follow-up, retry and archived-evidence journeys. [Pinned source/QA, failures, captures and limits](review-artifacts/2026-10-29-research-reading/README.md) remain preserved. Its model-review weaknesses are still documented; this is not general research accuracy.

Acceptance exercised:

- Scan retained public-source text locally for relevant passages, stay within the real inference budget, and persist the exact question, range offsets/hashes and selection rationale before generation. Do not imply the model read the whole document.
- Require both correct locations and supporting later-document quotations from real inference. A source-insufficient result stays unfinished; exact citation matching alone cannot certify that a question was answered.
- Show actual reading selections, progress, answer/review state and inspection actions in the existing Goals window. Keep selection/source identity across close, reload, cancellation and interruption.
- Ask a different question from the same saved sources through an explicit new linked goal. Reuse verified copies without refetching, preserve the parent's accepted answer, and keep draft conflicts visible.
- Add real user-goal journeys for the later-document answer, saved-source follow-up and honest insufficient-evidence recovery. Preserve the original failed native run for comparison.

Owner reproduction: `/workspace/.cloud-env/anascummis/later-source-before/native-Zo9600/receipt.json`. The source is the public WHATWG Fetch repository README, content SHA-256 `d484144421db3f758ef98fe5bf13c3dbe1e07a357033af5288298ea0f4f2ceaa`. Code baseline: `678264ac5fd075921ef7e780f333c00432857423`.

## Verified bounded increment: usable generated software and a persistent task list

Actual task-list goal:

> Build a task-list application with heading My Tasks, a text input labelled New task, an Add button, and a Remove button for each task. Add task text to the list, remove individual tasks, and persist remaining tasks after a page reload. Include browser checks and give me the source ZIP.

Two baseline failures were reproduced against the real model: the message route treated “remaining tasks” as a status query and saved no build; the unchanged request through the existing Software form reached Qwen but stopped at revision 0 after four decisions with “Inspect a target source file first.” The current counter compiler also produced browser-default controls only 21px high, with no visible Count label.

The increment verifies narrowly bounded fixes: whole-request command routing, the existing counter's responsive/keyboard usability, a disclosed trusted collection compiler with storage/error/revision acceptance, actual downloaded-source start checks, visible run instructions, and correct model-launcher exit reporting. A real saved native-generated checkpoint recovered through explicit validation retry with unchanged source/revision/model calls; old failed text checks remain inspectable. Fresh desktop/360px task-list/revision and counter journeys passed, including actual downloaded projects. [Pinned evidence and limits](review-artifacts/2026-10-29-software-goals/README.md) accompany the [acceptance plan](review-artifacts/2026-10-29-software-goals/PLAN.md). None of these claims arbitrary model-authored apps.

## Verified increment: use a checked application in its work window

Supported counter and task-list cards now offer explicit Start/Stop and a real interactive preview of the accepted client page. Preparation checks the exact accepted ZIP and known compiler source, uses existing matching React dependencies, and pins a separate runtime identity. A fixed owned asset worker serves that page at a stable lineage address; other applications retain manual source instructions. Launch performs no model call or dependency installation.

The [launch review](review-artifacts/2026-10-29-app-launch/README.md) records four ordinary-server launch journeys at source `32bbce68`, with 44 outcome assertions, plus two read-only navigation cases. Actual desktop/360px/360×420 views retain readable app content and reachable Stop/status controls. Checks cover saved items across Stop/Start, graceful/forced host interruption and explicit reconnect, same-origin parent/child use, source/download preservation, collision refusal and unconfirmed delivery without replay. Live builds remain discoverable beyond the recent-build page. These tests reuse previously native-generated accepted work; they do not establish fresh inference or arbitrary app-server execution. Physical devices, Windows/macOS and voice remain unverified.

## Next user-result target: a native multi-specialist deliverable

The individual research/answer and artifact paths have bounded evidence, but a useful research→written brief→downloaded document job with genuine native decisions and interrupted continuation is not yet proven. Reproduce that complete user goal before changing the harness: require cited source identity, inspectable dependent handoffs, an actual usable exported artifact, and explicit continuation after restart without repeating accepted work. This is the next acceptance target, not a delivered capability or a substitute for the remaining general-worker failures.

## Remaining capability milestones

| Milestone | Current evidence/gap | User-result acceptance |
| --- | --- | --- |
| Software beyond the typed recipes | Counter and bounded persistent collections have genuine output/revision evidence. The unrestricted worker still failed the original task-list request before it acquired a registered compiler. | Reproduce and complete a useful request outside these recipe classes, preserving the full goal and meaningful output tests; do not count a new template as arbitrary coding ability. |
| Useful native document editing | Backend PDF edits/rendering and simple import/export work; a multi-page native edit journey is absent. | Edit a supplied multi-page document, preserve unrelated content/layout, inspect actual pages and download the correct revised file. |
| Cross-specialist work | Individual capabilities and bounded evidence handoffs exist; realistic research→draft→artifact work is not broadly proven. | Use cited research to produce a requested brief or website section, with source provenance and acceptance for every dependent step. |
| Real long-job recovery | Earlier host-flow interruption/revision tests include scripted inference; current native benchmark mainly covers close/reload. | Interrupt a genuine multi-stage native job, restart, inspect exactly what finished, and explicitly continue without repeating accepted writes. |
| Voice as a usable primary interface | Native model readiness is established; microphone, transcription and complete spoken replies are not. | A real spoken goal reaches the correct artifact, supports interruption and recovery, and offers typing when voice fails. |
| Capability extensions | Tools are host-registered; reading source or proposing a harness is not installing a verified capability. | Add a bounded capability with dependencies, permissions, useful native acceptance tests and visible provenance before activation. |

These are testable gaps, not completed features or delivery promises. Pick the next increment from actual user failures after the active milestone is verified. Keep this file updated with evidence and preserve limits rather than replacing hard tasks with easier benchmark goals.
