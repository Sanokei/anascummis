# Persisted source questions in Goals

This increment connects the existing public-page reader, analysis specialist and Goals ledger. A supplied public URL can now be fetched and retained before inference is available. The exact question, dependent reading steps, source identity, progress, selected excerpts and answer citations remain inspectable in the existing Goals window.

Source: [`75dd7f01a49909a470522165a71c0acbe558e3ab`](https://github.com/Sanokei/anascummis/commit/75dd7f01a49909a470522165a71c0acbe558e3ab), tree `2d62aa820ef3e79caf6164c2213b8aac75ab02e2`, branch `codex/source-question-20261029`. Base: reviewed source-kit checkpoint `25a5379713dafc12df0e59dbc9fef130c087e5d0`. The artifact commit follows the final source; it changes no application files. [Exact paths and validation provenance](source.json), [audit/acceptance plan](PLAN.md), [checksummed artifact inventory](manifest.json).

## Try the actual path

Use the existing prepared local Studio, or check out this branch and follow the repository's supported local UI build/start instructions. No search secret is needed for supplied URLs. The cloud setup draft remains revision 5; this is a separate repository change.

1. Select **Type a message**, enter `show goals`, and explicitly Send. In Goals, choose **Question from public sources**.
2. Enter a focused question, such as `Which standard does this repository host?`, and `https://raw.githubusercontent.com/whatwg/fetch/main/README.md` as its source. Enable **Allow public web research for this goal**, then **Save question and read sources**.
3. Open **Content identity** and **Inspect saved text**. These show the retained response/text identity and paged text; inspection does not fetch the public URL again.
4. If local AI is unavailable, the answer becomes **Needs attention**, with an actionable Download/setup instruction and **Continue remaining work**. No answer is fabricated. Explicit continuation retries unfinished analysis/review using the same saved sources. Stop, Close, reload and backend restart preserve prior acquisitions. New URLs or a fresh fetch require a new question.

Questions are limited to 1,000 characters, one or two sources, and 500-character continuation guidance. Each UTF-8 text response is bounded to 500,000 bytes. The answer selects the **first 800 UTF-16 text positions** of each source; the rest remains inspectable but was not submitted as answer context. No PDF, website or vault content is read/sent by this path. Arbitrary destinations retain the original DNS-pinned public-address guard. The fixed public GitHub raw origin alone uses the existing zero-redirect public-feed transport, without credentials/query parameters. The direct DNS probe failed `ETIMEOUT` in this environment; normal configured fetch returned the permitted public sources. No network/TLS/allowlist setting changed.

## Actual validation

| Evidence | Observed result |
| --- | --- |
| [Affected checks](validation/affected-tests.log) | 43 tests, 204 assertions, 4 files, zero failures. Covers persistence/reopen/integrity, cancellation/late results, saved-before-return recovery, citation rejection, permission/bounds and unchanged generic Goal evidence/recovery. |
| [Final TypeScript](validation/typecheck.log), [production UI build](validation/build.log) | Both exit 0. Direct Next.js 16.4.3 build; no new source-kit batch or unrelated 192-test/lifecycle cycle. |
| [Normal server + real fetch lifecycle](receipts/lifecycle.json) | Exact multiline question; two real WHATWG sources saved; source steps accepted by host byte/text identity checks; answer `needs_input` with native model.ready=false. Newer pending-save question/URL drafts preserved. Real touch Close/reopen/reload and explicit native retry preserve both snapshots and acquisition attempts 1. |
| [Independent persisted-byte hashes](receipts/persisted-source-hashes.json) | Fetch README 4,815 bytes, SHA-256 `d484144421db3f758ef98fe5bf13c3dbe1e07a357033af5288298ea0f4f2ceaa`; HTML README 887 bytes, SHA-256 `a36af09bcf4ed0230de83305d8029075ca657bccb9421f39504e79692adf7c74`. Byte and text hashes match the full SQLite records. |
| [Fresh normal window/focus checks](receipts/normal-window.json) | Real one-source native failure/retry. At 360×800 and 360×420 with Work open, focused Continue is visible, hit-testable and within the viewport. Space retries explicitly without repeating acquisition; text paging and Control+Delete close/reopen work. No model/API/voice/viewport mocks in this run. |
| [Scripted host-flow portion](receipts/lifecycle.json) | Same real source records. Stop during answer generation, discard late response; restart the owned host with SIGKILL while another answer is in flight; restore interrupted/needs_input without automatic replay; explicitly Continue, check exact quotes/offsets/hash links, independent answer review and full-question coverage. Both acquisition attempts remain1. This is **scripted tokenization/inference**, not native Qwen or answer-quality evidence. |
| [Retained answer inspection](receipts/accepted-inspection.json) | The previously scripted answer/citations remain visible after another ordinary restart with model.ready=false and no scripted model running. |
| [Delayed reader close before](receipts/read-close-before.json) / [after](receipts/read-close-after.json) | A deliberately delayed protected saved-text GET reproduced late reopening after Close. Final source aborts/retires that read, keeps it closed, and supports explicit Inspect again. No public fetch or mutation was replayed. |

The full acquisition/native/scripted lifecycle and 43-test run used source `4c66da150296b9710ba04c05f5119185fe5367e2`. The only later source delta is `GoalSources.tsx` abort/stale-read handling. Final TypeScript/build, delayed-read browser check and retained-answer inspection use `75dd7f0`. [Replay scripts](drivers) preserve that distinction. The first failed browser run and both focused close-race results are retained under [validation/failures](validation/failures); the visible window-header Close failure was repaired by restoring pointer events to tab headers, then verified with real touch and keyboard. No forced click was used.

## Original window previews

These source-pinned PNGs are the accessible review preview through the private GitHub repository; no public application deployment or loopback preview link was created. Screenshots are original desktop Chromium/touch-emulation captures, without drawing or compositing.

| Normal server: real sources, native AI unavailable | Scripted answer-flow proof |
| --- | --- |
| [Before desktop](screenshots/before-goals-desktop.png), [before narrow](screenshots/before-goals-narrow.png), [source-question form](screenshots/source-question-form-narrow.png) | [Stopped](screenshots/scripted-stopped-narrow.png), [interrupted restart](screenshots/scripted-interrupted-narrow.png) |
| [Needs attention desktop](screenshots/native-needs-input-desktop.png), [source URL/title/time/hashes narrow](screenshots/native-source-identity-narrow.png) | [Retained answer desktop](screenshots/scripted-answer-start-desktop.png), [narrow](screenshots/scripted-answer-start-narrow.png), [citation/limit continuation](screenshots/scripted-answer-citations-narrow.png) |
| [No fabricated answer + retry](screenshots/native-no-answer-retry-narrow.png), [focused retry 360×420 with Work](screenshots/native-focused-retry-360x420.png), [saved text paging](screenshots/native-saved-text-narrow.png) | [Saved phase history](screenshots/scripted-history-narrow.png), [late reader close before](screenshots/read-close-before.png), [after](screenshots/read-close-after.png) |

## Preservation, limits and next step

[Preservation receipts](validation/preserved-parents.json) confirm the accepted original parent record, source/tests/lock/ZIP, patched parent's source/ZIP and prior review manifest are unchanged. The saved setup draft's install/start fields remain byte-identical at revision 5. Main remains `df70f5ccdb9c3474f04d3f83ad7f60a8f7ecf917`. Earlier review packs, dependency declarations/lockfiles and packaging scripts are untouched. The existing 199-file kit version `c5735e970e817eed43877b610e7bb79af6dde2ad05c452eaf2a320e74f09acd4`, archive SHA `b73cc2f7f7950efb6ade3d2a7ec5f296a9950f30af0afe760efbe5fa80439f47`, remains the previous source `f8329eba` kit; it has not been repackaged to claim this increment. Its unchanged files were restored to ignored serving output after direct UI builds cleared that directory.

Native Qwen/model-and-voice readiness remains blocked by missing weights/previous Hugging Face 403; no blocked download, provider/secret provisioning or network workaround was attempted. Scripted decisions prove host flow only. Literal matching is not semantic/factual verification; arbitrary public-web reachability, genuine local-model answer quality and physical handset/on-screen-keyboard behavior remain unverified.

Next: add explicit **user-selected saved-text ranges** with citation offsets and budget checks, so a question about later content can proceed from retained sources without refetching. Keep the current automatic first 800-position selection visible until that separate increment is accepted.
