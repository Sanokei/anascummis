# Real source questions, follow-ups and recovery

The project is unfinished. This increment fixes an observed false-completion case and verifies one useful research path with genuine local inference. It does not establish general model competence.

## Exact source and scope

- Base: `678264ac5fd075921ef7e780f333c00432857423`.
- Tested source: [`ae14b819d142bf047e9c1ae32f0ee131d4ba6074`](https://github.com/Sanokei/anascummis/commit/ae14b819d142bf047e9c1ae32f0ee131d4ba6074).
- Source tree: `5aa8142bd9d9112ab0d3f5f900da9ebad6120f1f`.
- Scoped branch: `codex/research-reading-20261029`. Main remains `df70f5ccdb9c3474f04d3f83ad7f60a8f7ecf917`; no deployment or main promotion.
- [Source paths and intermediate checkpoints](source-paths.json), [acceptance plan](PLAN.md), [artifact hashes](manifest.json).

At the base, the real model answered a question about Fetch tests without either requested location, admitted missing information and still passed completion. The app retained the full README but sent only its first 800 positions to inference. [Original failure receipt and screenshots](before/false-completion-678264a/receipt.json) are preserved.

The existing Goals window now saves a question-based reading plan before inference, with exact question, range offsets/content hashes and selection rationale. A local lexical scan considers the retained full text; at most two passages and 1,600 UTF-16 positions enter an answer decision. It can miss relevant text and does not mean the model read the whole source. Explicit linked questions copy verified snapshots without refetching or changing their parent. Public-research opt-in and original project/source context remain required.

Literal quotation generation then failed in both real UI runs at `49bbefe`. Stronger copying instructions did not fix it. The final protocol lets the model choose IDs from **all** literal spans in the selected passages; the host resolves their exact text and offsets. A separate native support check sees the actual draft answer and only its chosen quotations. The original draft self-assessment and the later decision remain inspectable, including disagreements. Existing acceptance and full-question coverage reviewers also receive concrete passages and the actual answer. Missing/malformed review results cannot fabricate support.

## Actual outcomes

Both runs used the ordinary production Studio, fresh isolated local data, the real public reader and the already running Qwen3-0.6B Q4_0 CPU runtime. There was no scripted inference, mutation-API seeding, hosted-model fallback or new model download. Both reports identify the same **clean** tested source.

| Journey | Desktop 1440×1000 | Narrow 360×800 | Evidence |
| --- | --- | --- | --- |
| Later README facts → linked saved-source follow-up → honest refusal/retry/history | Passed | Passed | [Original report](native/later-source/report.json), [HTML](native/later-source/report.html) |
| Existing simple public-source answer | Passed | Passed | [Original regression report](native/source-regression/report.json), [HTML](native/source-regression/report.html) |

These are four journey executions, 24 assertions and **three supported question types** exercised at both widths. The deliberately absent postal address is **not counted as answered**. It remains `needs_input` before and after one explicit retry per viewport.

The actual tested lifecycle was:

1. Open Goals through the visible first-use actions; enter the exact question and public URL; explicitly allow research and submit.
2. Fetch and retain the WHATWG README once. Save the selected reading before answering. Answer both test-location facts with literal quotations at absolute positions **1914** and **2057**, within the later passage **1400–2200**.
3. Inspect the selected saved text and hashes; inspect lazy reading history; close/reopen Goals and reload without a new question or acquisition.
4. Explicitly stage and send a new linked question about quick local iteration. Answer **`make`** and its **web-service dependency**, citing the statement at **2191**. Verify distinct copied snapshot IDs with identical retrieval time/content hashes, no public fetch and an unchanged parent.
5. Ask for the absent maintainer postal address. Require an actual negative support decision with no review error. Focus and hit-test Continue, explicitly retry without retyping or guidance, and require the same reading/source identities and `needs_input` again.
6. Inspect the exact archived first refusal, original draft and support check. Close/reload/reinspect it without another retry or automatic replay. Accepted source steps remain unchanged.

[Post-validation](validation/post-validation.json) independently matches all **5 runner**, **25 application** and **88 served-build** fingerprints for both reports. [Runner verification](validation/runner-post-validation.json) records report hashes and native retry scope. The large redacted browser traces remain local, with paths/sizes/hashes in [the trace inventory](validation/local-traces.json); databases, pairing keys, caches and model weights are excluded.

## Original window captures

All PNGs are original browser captures, copied without image editing. The full captured sequence is beside each result receipt.

| View | Desktop | Narrow |
| --- | --- | --- |
| Later saved passage | [Inspect](native/later-source/later-source-followup-desktop/03-selected-later-passage-edf96256.png) | [Inspect](native/later-source/later-source-followup-narrow/03-selected-later-passage-edc99af5.png) |
| Accepted test-location answer | [Answer](native/later-source/later-source-followup-desktop/04-later-answer-edf96256.png) | [Answer](native/later-source/later-source-followup-narrow/04-later-answer-edc99af5.png) |
| Linked make/web-service answer | [Follow-up](native/later-source/later-source-followup-desktop/08-later-answer-894451ea.png) | [Follow-up](native/later-source/later-source-followup-narrow/08-later-answer-d2fa3dbb.png) |
| Visible, focused retry | [Continue](native/later-source/later-source-followup-desktop/11-insufficient-focusable-continue.png) | [Continue](native/later-source/later-source-followup-narrow/11-insufficient-focusable-continue.png) |
| Archived original draft/checks after retry | [Archive](native/later-source/later-source-followup-desktop/13-archived-native-draft-and-check-862d1807.png) | [Archive](native/later-source/later-source-followup-narrow/13-archived-native-draft-and-check-af78f8aa.png) |

Independent static review inspected desktop/narrow answers, selected passages, narrow Continue and archived checks. It found contained opaque panels, intentional scrolling and no captured text overlap. That visual review is separate from the owner’s API/model/persistence assertions. There is no new public preview URL; the existing public deployment was unchanged.

## Checks and preserved failures

- [74 focused tests, 571 assertions](validation/final-affected-tests.log), zero failures. These use scripted decisions to verify host behavior; they are separate from the native browser results.
- Both TypeScript targets passed; [frontend](validation/final-frontend-typecheck.log), [backend](validation/final-core-typecheck.log). Successful logs are empty.
- [Production Next.js 16.4.3 build](validation/final-build.log) passed.
- [First native citation failures at `49bbefe`](before/literal-native-49bbefe/report.json) remain failed; they are not relabelled successful.
- [Literal-generation diagnosis](diagnosis/native-literal-diagnosis.json), [span-ID prototype](diagnosis/native-span-prototype.json), [unsafe evidence-only reader](diagnosis/native-evidence-reader-prototype.json) and [positive/negative post-answer candidate](diagnosis/native-post-answer-protocol.json) preserve actual prompts, schemas and raw model decisions. The unsafe evidence-only classifier was **not shipped**. The initial diagnostic hashing-helper failure occurred before inference and is retained separately.
- Original accepted parent record/files/ZIP, prior review manifest and frozen source kit hashes remain unchanged in post-validation.

## Current use and restart

The prepared cloud machine has the tested Studio running at port 3211, PID **17855**, after a graceful restart with zero active Goals/Work/Software jobs. The real model PID **700** was preserved. [Activation receipt](validation/normal-server-restart.json) verifies a ready model and HTML matching the tested build; no real user work or model process was restarted.

Reuse those running services. After an environment restart, first activate the existing tools with `source /workspace/.cloud-env/anascummis/env.sh`. From `apps/studio`, start `bun run model:start` only when its existing service is absent, and run `STUDIO_DEV=0 bun core/server.ts` in a separate session when Studio is absent. Installed verified weights are reused. The reusable saved environment startup instructions already describe this workflow; this code increment changes no environment configuration.

To reproduce the affected browser checks from the built checkout, use fresh output directories:

```sh
node scripts/test-user-journeys.mjs --journey later-source-followup --viewport all --require-model --output .test-data/user-journeys/reproduce-later-source
node scripts/test-user-journeys.mjs --journey public-source-answer --viewport all --require-model --output .test-data/user-journeys/reproduce-source-regression
```

For another machine, check out the exact source pin and follow [LOCAL-INSTALL.md](../../apps/studio/LOCAL-INSTALL.md). A fresh online install, extraction of a new kit and Windows/macOS operation were not reverified here. The preserved Download kit still identifies its prior source `bd1f47213f0eff8ce1685a041782910ebd9e73a1`, version `e3e76d87cf900de935c8eeaf2bc096e10918abd29271df54cf7b9f99813b9c99`, ZIP SHA-256 `274c19938daa74708b91b9dfedf49886880be17a513ffb14d0bbc72fc9d183e2`; it does **not** contain this increment. No repeated kit build or extraction pass is claimed.

## Limits and the next useful goal

The small model still produces weak output: the rejected postal draft/reason speculates about Guidelines, some reasons are verbose/truncated, and the make answer adds an irrelevant literal “See more” fragment. Rejected content is retained behind a labelled disclosure; a positive model review does not establish general factual accuracy. The fixed inference context, lexical retrieval and same-model reviewers remain limits.

History currently exposes the latest archived result per reading and its total count. Legacy archived answers without any reading ID remain durable in SQLite but are not linked into the per-plan history UI. Native abrupt-process interruption, changed-guidance archive UI, physical handset keyboards and native voice were not tested in these journeys. Earlier restart/rollback tests are host-flow evidence, not new native proof. The earlier Hugging Face 403 was resolved by the user’s applied network change; it is historical, while voice remains unverified.

The next acceptance target is **software beyond the typed counter**: a task-list app that adds/removes items, persists them after reload, runs from its delivered output/source, and accepts a revision while preserving its accepted parent. Add that real user journey and reproduce its first actual failure before implementing a bounded fix. Other unfinished milestones are in [the working roadmap](../../PROJECT-ROADMAP.md).

## Public-source attribution

The retained README and excerpts are from [WHATWG Fetch](https://github.com/whatwg/fetch), retrieved through its public raw URL. Text SHA-256: `d484144421db3f758ef98fe5bf13c3dbe1e07a357033af5288298ea0f4f2ceaa`. Original full text is copied unchanged; selected passages are literal slices, and model-generated answers are separate. Copyright © WHATWG (Apple, Google, Mozilla, Microsoft), licensed under Creative Commons Attribution 4.0; source-code portions use BSD 3-Clause. [Existing publisher license](validation/WHATWG-FETCH-LICENSE.txt), Git blob `f2dcda46deccefd245749202a88a7837e35c6daa`, is retained. No endorsement is implied.
