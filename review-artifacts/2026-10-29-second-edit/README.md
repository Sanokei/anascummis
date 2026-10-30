# Edit an accepted revision again, without losing earlier work

The actual accepted version-1 research brief now supports a separately tracked summary rewrite and explicit approval of version 2. Genuine installed Qwen shortened its current summary from 216 to 143 readable characters, retaining both locations, citations and all 1,719 characters of personal notes. Versions 0/1 and their provenance, accepted parent records and original source identities stayed unchanged.

This is a bounded structured-summary result. It does not establish arbitrary PDF editing, general prose accuracy, native evidence selection, voice or physical-device support.

## Exact checkpoints

| Item | Pin |
| --- | --- |
| Accepted base/source and prior evidence | `1c5a0851a587e0e45eef81beb130f733c0da5038` ([prior review](../2026-10-29-document-edit/README.md)) |
| Implementation and first production build | `298557eea2091f1f709653c314fb2d0fb99a1f16` |
| Both complete native journeys | `b8e05a68eeaa203b6e16cfb787ef71bb1a756a60`, tree `91084c8b1ed60fe27ea1ac027595132a09d11ee5` |
| Current product, final build and kit | `6f3144a0af91334c4c9228b302a00aa117b56baa`, tree `4a63cb9b39baa0a1aa7ae5f3ef9ae52ad62a51dd` |
| Branch | `codex/current-revision-edit-20261029` |

`b8e05a6` corrects one runner wait that negated a Promise rather than awaiting visibility. The only product change after the native journeys is the technical detail label **Base version 1 PDF SHA-256**, correcting the misleading word “Original.” Backend behavior, model requests and factual output are identical. The final source passed a new build, both TypeScript targets, two affected UI tests and [read-only reopening of the actual accepted native version](final-ui/receipt.json). These final captures do not claim a new native generation or Apply.

## Actual goal and result

> Shorten the current summary to one sentence for a newcomer; keep both exact locations and citations and do not change notes/evidence.

Actual unchanged native response text in both cases:

> Tests for the Fetch Standard are located in the fetch/ directory of web-platform-tests/wpt, and results are available at wpt.fyi/results/fetch.

The raw response separately contains citations `[1, 2]`. The host wraps this exact text in the existing paragraph structure; it does not join, rewrite or repair its factual wording. Literal checks require one complete sentence, fewer readable characters, retained locations and citation identities. A separate T0 native support role reviews the intent and evidence. Neither role independently establishes factual accuracy.

The [aggregate](native-summary.json), [desktop receipt](desktop/report.json) and [360×420 receipt](narrow/report.json) retain exact questions, operation/base identities, raw decisions, controls, requests, process cuts, artifacts and hashes. Both journeys passed: **2 achieved, 0 blocked, 0 failed; 16 outcome assertions**. They begin with separate stopped copies of the previously genuine accepted version 1; they do not regenerate original research or alter normal user data.

Both cases exercise:

1. Download and identify original versions 0/1, complete notes, citation/source identities and stored ancestor JSON before editing. Preserve the exact new draft through close/reopen and reload.
2. Lose the actual create acknowledgement; GET inspection discovers one saved child without another submission. Explicit Stop and Continue preserve that child.
3. SIGKILL the owned Studio after its genuine rewrite is saved but before support review finishes. Restart requires explicit continuation and retains the exact saved native response.
4. Review before/proposed text, rendered citation links and exact raw evidence. Escape/Cancel restores focus without approval or Stop. Desktop uses a 960px dialog; the short phone view stacks sections with intentional middle scrolling and fixed controls.
5. Create a deliberately separate competing proposal against version 1 as a negative API test. Lose A's delivered Apply acknowledgement and SIGKILL while approval is saved, execution is running and no revised artifact is registered. Inspect, then explicitly continue one operation to one version 2.
6. Reject B's stale Apply/Continue without replacing its raw response. Reject fresh stale version-0/1 requests before creating another child. Open/download actual PDF, HTML and provenance; compare historical files and ancestor JSON byte-for-byte, then reopen after SIGTERM/restart without another mutation.

The competing proposal is a conflict test, not another completed user goal. Real process cuts cover the recorded boundaries; filesystem/SQL collision and late-Stop windows have separate injected tests, not a power-loss claim.

## Small original review set

All PNGs are original captures or actual PDF rasters, indexed with their source paths and SHA-256 in [original-copy-index.json](original-copy-index.json). No image was edited.

| View | Original |
| --- | --- |
| Full 1440px comparison and Apply | [Native proposal](desktop/01-expanded-full-comparison-and-apply-1440.png) |
| Final-source saved review | [Reopened version 2](final-ui/final-reopened-review-1440.png) |
| Phone comparison, sequential scrolling | [Before](narrow/01-stacked-before-comparison-360x420.png), [proposed and Apply](narrow/02-stacked-proposed-and-apply-360x420.png) |
| Unconfirmed Apply, no replay | [Focused Inspect and Cancel](narrow/03-unconfirmed-apply-inspect-360x420.png) |
| Saved phone actions | [Open/download](narrow/04-saved-version-2-actions-360x420.png) |
| Final base/version detail | [Corrected label](final-ui/final-base-version-label-360x420.png) |
| Actual output | [PDF page](desktop/version-2-pdf-page-1.png), [reader](desktop/02-actual-version-2-pdf-reader-1440.png), [phone HTML](narrow/version-2-html-360x420.png) |

The short proposal fragment meets the middle scroll boundary; a single fragment does not show every final pixel or both sections simultaneously. Controls remain opaque and reachable. [Independent static review](independent-review/independent-visual-review.json) separates this captured scope from the owner's dynamic focus/touch/native checks. Desktop output is a readable one-page document with full notes, formatted references and provenance outside the ordinary body. Actual files: [desktop PDF](desktop/version-2-revised.pdf), [HTML](desktop/version-2-revised.html), [full provenance](desktop/version-2-provenance.json), [phone-run PDF](narrow/version-2-revised.pdf).

## Validation and retained failures

[Gates summary](gates-summary.json) links the exact logs. The substantive implementation passed 70 affected tests / 1,144 assertions, a separate lock/cancellation test / 2 assertions, both TypeScript targets and production build. Final label-only source passed 2 UI tests / 150 assertions, both targets and production build again. Earlier subset runs are not added into a larger count. Injected model/transport/UI fixtures and real PyMuPDF tests are separate from genuine native user journeys.

[Independent checkpoint audit](independent-review/independent-checkpoint-review.json) verifies all 72 indexed copies, opens/parses actual outputs, checks the stopped native-run database history/ancestor bytes and audits the final kit. Its source, artifact, static and native evidence limits remain separate. [Final normal-data verification](normal-runtime/final-preservation.json) repeats the 24-table comparison after the final build and read-only reopening.

[Source review](independent-review/independent-source-review.json) caught and verified fixes for a late publication after Stop and synchronous Create/Apply wakeup reentering the document lock. The lock now waits abortably; actual Create/Apply work in both native journeys. [Historical-plan verification](independent-review/independent-historical-plan-check.json) reproduces accepted v1 HTML/provenance bytes exactly without inference or database changes.

Failures remain failed evidence:

- Three ordinary T0 diagnostics did not produce the requested shorter single sentence. [Raw requests/results](diagnostics/report.json) remain available.
- Initial regex probes relied on an unsupported `\s` character-class escape. The real runtime warned that it was accepting any string. A contradictory enum control proved the schema envelope works; a corrected literal-space pattern instead returned HTTP 500. [Pattern](diagnostics/pattern-report.json) and [provider controls](diagnostics/provider-controls-report.json) preserve these distinct outcomes.
- The [first desktop run](failures/desktop-runner-promise-wait/report.json) failed the runner's Promise-negation wait. The private trace confirms Inspect had correctly reconciled the saved approval; the corrected runner repeated the unchanged goal on a fresh clone. The original failed report and screenshot remain, and its trace stays private.
- Initial UI strict-locator ambiguity from duplicate closed-dialog wording, later React commit timing, the held backend-test verification gate, and initial missing shell PATH are retained in the gate logs. None is relabelled as native success.

The new writer uses Qwen's documented non-thinking temperature 0.7, top-p 0.8, top-k 20 and min-p 0, plus `enable_thinking=false`. **Seed 42 is a local reproducibility choice**, not a model-card recommendation. This profile is recorded before inference and applies only to the current-summary writer. Default inference and support review remain T0; the resident model/runtime were not changed. See the [successful diagnostic](diagnostics/document-profile-report.json), [Qwen card](https://huggingface.co/Qwen/Qwen3-0.6B/raw/main/README.md), [runtime docs](https://github.com/ggml-org/llama.cpp/blob/8642541b2/tools/server/README.md) and captured source identities. `research/AUDIT.md` is a chronology: its older local `diagnostic/`, `native-desktop-*` and `native-narrow-*` paths map to this pack's `diagnostics/`, `desktop/` and `narrow/`.

## Use and restart

The prepared local Studio is at **http://127.0.0.1:3211**. This is a loopback address in this environment, not a public preview URL. Its owned refresh preserved all 24 existing table row digests and API data; no test fixture was imported. [Preservation receipt](normal-runtime/preservation-summary.json) and [current same-origin kit GET](normal-runtime/current-kit-get.json) are explicit about that scope. Main/public deployment and unpublished environment draft 13 remain unchanged.

On an accepted current brief, open **Edit current brief**, enter the goal above, save, and open **Review proposed change**. Apply only the inspected proposal. After uncertain delivery, use **Inspect saved edit**; after interruption, use **Continue remaining work**. Opening/reloading never approves or automatically replays it. Existing original and base/revised downloads remain pinned. The current rewrite action requires an explicit shorter-one-sentence request; other edit types are not silently converted into it.

The current [source ZIP](kit/anascummis-studio-def6e726f276638a.zip), [manifest](kit/manifest.json) and [checksum](kit/anascummis-studio-def6e726f276638a.zip.sha256) contain **278 payload files, 2,470,745 bytes**. Version: `def6e726f276638ac1021000218d226cadf5505b5e5817b2457324d3cfc4c6d5`. ZIP SHA-256:

```text
d790e37c6fbc10acb93e14b8efcba02d34c70913d60a66ba7d6331265b46c376
```

[Final offline kit audit](gates/kit-def6e726f276638a-verification.json) checks every payload/hash, pinned source, licenses/lockfile and exclusion boundary. The earlier native-run kit is preserved under `kit/native-run/`; use the current ZIP above. There was no new clean extraction or fresh online installation in this increment.

For an extracted kit, install Bun, Node 20.9+ and Python separately, open a terminal in `studio`, then follow `LOCAL-INSTALL.md`: `bun install --frozen-lockfile`, `bun run setup`, `bun run build`, `bun run start`. AI and voice have separate setup prerequisites; weights/dependencies/private data are not in the ZIP. This prepared checkout already has the tested Qwen model; do not start a second copy while its service is running. If Studio has been stopped here, `PATH=/workspace/.cloud-tools/node_modules/.bin:$PATH bun run start` from `/workspace/anascummis/apps/studio` uses the existing build. Keep the app terminal open and use Ctrl+C to stop its owned process.

To rerun native acceptance with an explicitly stopped accepted-v1 data directory, use `bun run test:e2e:research-document-second-edit --fixture /absolute/path/to/accepted-v1-data --viewport desktop --output /fresh/output`, then inspect its output before repeating with `--viewport narrow`. Fixture databases, keys, full traces, model files and private backup remain excluded from this pack.

[Model identity](readiness/local-model-identity.json): Qwen3-0.6B Q4_0, 428,970,080 bytes, SHA-256 `da2572f16c06133561ce56accaa822216f2391ef4d37fba427801cd6736417d4`, official `ggml-org/Qwen3-0.6B-GGUF` revision `13ac06624948e4d8589cb4b6f90100837342fcb8`; installed `.runtime` file, not an HF SDK cache snapshot. llama.cpp b11960/`8642541b2` stays on the same local process. Earlier HF403/download failures remain historical failures; this host now has real working inference. Browser voice requests were blocked in the harness and voice remained unavailable. Physical handset, microphone/spoken replies and fresh Windows/macOS installation remain unverified.

## Next useful goal

The current contract still cannot edit personal notes or handle an ordinary broader revision such as “Make this clearer for a newcomer” without a specific one-sentence instruction. The next acceptance target is an explicit section-aware revision: preserve the full request, clarify the intended section/format, show a native proposal and exact changes, and retain the same no-replay/version protections. Test a real notes/summary goal and its exported artifact; do not count another formatter or copied quotation as general document editing. The broader project remains unfinished.
