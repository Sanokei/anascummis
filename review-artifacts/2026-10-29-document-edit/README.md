# Review and apply a grounded native edit

An existing two-page cited research brief now supports an explicit first summary edit: save an intent, inspect the proposed change and its evidence, then Apply one durable revision. The full notes, citations and original PDF/HTML remain unchanged. The new document presents readable source links and quotations; exact raw responses, source identities and hashes remain in a separate provenance view.

One concrete user goal passed through ordinary production Studio windows on desktop and 360px touch emulation. This is a bounded structured-brief edit, not arbitrary imported-PDF layout editing or general model competence. The actual Qwen responses **copy the two correct source quotations** after **host** retrieval; they do not demonstrate novel prose or native evidence selection.

## Exact source and kit

| Checkpoint | Pin |
| --- | --- |
| Preserved prior source/QA | `def43327504e652282516a2ff6b0a585160f0f73` |
| Tested product, both native journeys and source kit | [`1087bf742ab3c5542a0a6863f8125453e2565a8d`](https://github.com/Sanokei/anascummis/commit/1087bf742ab3c5542a0a6863f8125453e2565a8d) |
| Roadmap-only checkpoint / direct parent of this QA commit | `b1b5618130b4f5a54bbc262ace3e34a92fba2d24` |

[source.json](source.json) records exact trees, changed paths and the one roadmap-only difference after the tested implementation. This additive QA commit changes only this review directory. Main remains `df70f5ccdb9c3474f04d3f83ad7f60a8f7ecf917`; public deployment and unpublished environment draft 13 are unchanged.

[Current source ZIP](kit/anascummis-studio-0ec05b4bfa9d7cdd.zip): **271 payload files, 2,322,091 bytes**. Version `0ec05b4bfa9d7cddcfcd8705ac4f2117ebd970c90db91e01c674d0324612a138`; archive SHA-256:

```text
cabd18e2a8bfe494dbc85aefcd63f6831c8dbcb47d92318b3a03e688cbcca0aa
```

[Manifest](kit/manifest.json) · [Checksum](kit/anascummis-studio-0ec05b4bfa9d7cdd.zip.sha256) · [Payload audit](kit/verification.json). Every payload hash/size, version, CRC, unique safe path and exclusion was checked; 230 ordinary Studio files were compared with the exact Git pin, plus shared types and the standalone config transformation. Licenses, existing lockfile and Etro corresponding source are included. Databases, credentials, caches, dependencies and model weights are excluded. No fresh online install or clean extraction/start gate was repeated.

## Actual user goal and use

Open an accepted original research brief in Goals, select **Edit brief**, and enter:

> Rewrite the brief summary into two short sentences. Start the first sentence with “Tests:” and the second with “Browser results:”. Keep both exact locations and citation numbers; do not change my notes or evidence.

Select **Two labelled sentences**; enter `Tests:` and `Browser results:` in the first/second label fields. Choose **Save edit and propose changes**. The linked goal retains the exact intent and labels. Inspect the before/after text, **Host citation matching**, individual native responses and **Host sentence formatting**, then explicitly **Apply proposed edit**. Stop or Continue never approves a proposal. If delivery is unconfirmed, use **Inspect saved edits** or **Inspect saved edit**; these are GET inspections, not automatic replay.

The host reuses the accepted literal citations, ranks them using the existing label-term tokenizer and saves every candidate score, source/offset identity and selected quote/hash before inference. A positive match is a relevance hint; a missing match stays unfinished. Each native writer receives only its label and selected quote, with unconstrained sentence text and citation identity restricted to that quote. The separate support role receives the full intent, old summary, accepted answer and all literal quotations. Full notes and reading/source provenance stay preserved. This bounded task decomposition does not prove general semantic accuracy.

The accepted input comes from the prior genuine public-fetch/native-answer/native-writing journey. Its source is the official Fetch README at `https://raw.githubusercontent.com/whatwg/fetch/main/README.md`, 4,815 bytes, SHA-256 `d484144421db3f758ef98fe5bf13c3dbe1e07a357033af5288298ea0f4f2ceaa`. The two literal quotations start at positions 1914 and 2057. This increment does not refetch or re-answer accepted research.

## Tested lifecycle and actual output

| Lane | Actual result |
| --- | --- |
| [Desktop](desktop/report.json) | Passed, 8 outcome assertions, clean tested pin. |
| [Phone-sized touch](phone/report.json) | Passed, 8 outcome assertions, 360×800 and 360×420 actions. |
| [Affected gates](gates-summary.json) | 78 tests / 1,042 expectations; both TypeScript targets and production Next 16.4.3 build passed. Injected model/transport fixtures and real rendering/component checks are distinct from native inference. |
| [Current normal Download](normal-runtime/receipt.json) | Actual browser ZIP matches the version/bytes/hash above; zero POST, no page errors. |

Both native cases use fresh isolated copies of the stopped, previously accepted two-page brief. They inspect/download the actual original; preserve an unsent request across close/reload; lose an actually delivered create acknowledgement and reconcile one child; deliberately Stop; then SIGKILL only the owned Studio **after its first native response and evidence selection are saved**. Restart requires explicit Continue, retaining that exact first response/hash/ranking and writing only the missing second response. The two saved raw decisions and their disclosed label projection remain inspectable.

After reviewing the actual proposal, the UI Apply acknowledgement is lost. A second real SIGKILL occurs in **approved** phase, before publication. GET inspection and explicit continuation retain approval and register exactly one version 1. Actual browser PDF/HTML/JSON downloads are independently byte-compared with exact-URL GETs for MIME/hash evidence. The document opens through the existing PDF reader and exact-byte HTML preview, then reopens after graceful restart without another mutation. Unknown files, changed bases and rejected decisions remain blocked rather than overwritten or silently regenerated. Other filesystem/SQL windows have injected tests, not a power-loss claim.

[Original two-page PDF](before/original-accepted-brief.pdf) · [Fresh original reader](before/current-original-two-page-reader.png) · [Revised desktop PDF](desktop/revised-fetch-brief.pdf) · [Revised HTML](desktop/revised-fetch-brief.html) · [Exact provenance](desktop/edit-provenance.json).

The revised brief fits on **one readable page**, retains all **1,719 note characters once**, formats inline code/links and moves machine detail out of the ordinary reading flow. Its wording repeats the source facts in the references; `Tests: Tests…` is mildly repetitive but explicit. These are source-backed copies, not newly researched claims. The historical PDF hash remains `92e0223b2160ee34c8fa94275f713b6294c658206ccde328c0686e66e0bb5e0f` in both cases; its HTML bytes and persisted parent record are unchanged. Only computed edit eligibility changes after revision 1.

A small set of original views:

- [Actual desktop paper](desktop/revised-pdf-page-1.png).
- [Saved host evidence and first response](desktop/02-host-selected-quote-before-native-continuation.png).
- [Interrupted first response](desktop/03-interrupted-first-native-sentence.png).
- [Desktop before/after proposal](desktop/06-inspected-proposal-diff-1440x1000.png).
- [Phone continuation](phone/04-interrupted-first-sentence-explicit-continue-360x800.png).
- [Short-window continuation](phone/05-interrupted-first-sentence-explicit-continue-360x420.png).
- [Short-window explicit Apply](phone/09-explicit-apply-360x420.png).
- [Short-window saved actions](phone/11-saved-revision-actions-360x420.png).
- [Phone HTML](phone/revised-html-360x800.png).

[Independent desktop](independent-review/grounded-desktop-independent-static-review.json) and [phone](independent-review/grounded-phone-independent-static-review.json) reviews hash and directly inspect originals. Their static/file checks are distinct from owner process/inference receipts. All included PNGs are original, unedited captures/renders. Full traces, private databases and the local backup remain private; reports' local trace names do not imply those ZIPs are published.

## Failures retained

[The plan](PLAN.md) records the evidence-led corrections. Four actual native journey reports remain failed:

- [`84cbc01`](failures/native-first-desktop/report.json): an inspection checkpoint appeared after Stop; no native proposal or revision. Abort checks now cover asynchronous inspection boundaries.
- [`b5b3ddb`](failures/native-fixed-desktop/report.json): only one requested sentence appeared; the same-model reviewer falsely claimed the missing label was present. Nothing was applied.
- [`2d80d4e`](failures/native-labelled-desktop/report.json): wrong second-topic content and repeated labels; correctly rejected before Apply.
- [`fef2427`](failures/native-sequential-desktop/report.json): second response repeated the first byte-for-byte; partial recovery worked, but the user goal failed.

[Four broader prompt diagnostics](diagnostics/report.json) also failed. [Two single-host-selected-quote diagnostics](diagnostics/host-selection-report.json) passed before the final full journeys; they are not counted as UI goals. [Primary sources](research/AUDIT.md), [Qwen model-card retrieval](research/qwen-official-model-card-source.json), [renderer research](PRESENTATION-RESEARCH.md) and [quality-contract notes](research/review-quality-contract.md) retain their scope and content identities. No model or sampling change was used to turn a failed attempt into a pass.

Two mixed browser/PDF fixture runs also timed out while waiting for an already exited worker. [Investigation](gates/fixture-subprocess-investigation.json) preserves zombie-process evidence and both failed logs; the underlying runtime cause remains unproven. A test-only `execFile` helper retains the same real worker, assertions and 20-second test limit. The final combined gate passes. Product PDF process code is unchanged and is independently exercised by the native UI cases.

## Prepared host and remaining limits

[Verified model identity](readiness/local-model-identity.json): Qwen3-0.6B Q4_0 GGUF, **428,970,080 bytes**, SHA-256:

```text
da2572f16c06133561ce56accaa822216f2391ef4d37fba427801cd6736417d4
```

Official origin: `ggml-org/Qwen3-0.6B-GGUF`, revision `13ac06624948e4d8589cb4b6f90100837342fcb8`. Installed file: `/workspace/anascummis/apps/studio/.runtime/Qwen3-0.6B-Q4_0.gguf`. Runtime: llama.cpp `b11960` / `8642541b2`, `/workspace/.cloud-tools/llama/llama-b11960/llama-server`; official cached archive: `/workspace/.cloud-tools/downloads/llama-b11960-bin-ubuntu-x64.tar.gz`. The metadata includes exact origin URLs, binary/archive hashes and the live mapped-file proof. No weights were copied or downloaded.

The idle normal Studio was refreshed to the tested backend after a private SQLite backup. [Receipt](normal-runtime/refresh-receipt.json) verifies **all existing rows in 22 tables and API data unchanged**; two new application tables are empty. Database/WAL bytes change through these schema migrations, so byte-identical normal database files are not claimed. No fixture was imported. Studio PID **81304**, model PID **18848** remain running; the model was not restarted. `http://127.0.0.1:3211` is accessible only on the prepared host, not a public preview URL. Frozen prior kits and accepted artifacts remain preserved in [preservation.json](preservation.json).

If a service is stopped, use separate terminals on this prepared host; do not start duplicates on occupied ports:

```sh
export PATH=/workspace/.cloud-tools/node_modules/.bin:$PATH
cd /workspace/anascummis/apps/studio
LLAMA_SERVER=/workspace/.cloud-tools/llama/llama-b11960/llama-server bun run model:start
```

```sh
export PATH=/workspace/.cloud-tools/node_modules/.bin:$PATH
cd /workspace/anascummis/apps/studio
STUDIO_DEV=0 PYTHON_PATH=/workspace/anascummis/apps/studio/.venv/bin/python bun core/server.ts
```

A fresh machine must follow the ZIP's `studio/LOCAL-INSTALL.md`; dependencies/runtimes/weights are separate prerequisites. To recreate the fixture and bounded edit suite with a real installed model, use fresh output directories:

```sh
bun run test:e2e:research-document --viewport narrow --output .test-data/user-journeys/brief-NEW
bun run test:e2e:research-document-edit --fixture .test-data/user-journeys/brief-NEW/research-document-narrow/private-data --viewport all --output .test-data/user-journeys/edit-NEW
```

The first command creates new genuine research/writing; this increment's recorded edit runs reuse the previously accepted fixture instead. Managed browser `file://` policy is unchanged; the supported Studio HTML preview serves the exact downloaded bytes. Physical devices/keyboards, voice, native Windows/macOS, arbitrary imported PDFs and arbitrary model-written server execution remain unverified.

The next observed usability gap is **editing the current version again**: version 1 currently disables another original-only edit. The recorded next acceptance target is one explicit version 2 from the current accepted base, retaining versions 0/1 and unrelated notes/citations through another interrupted continuation. This is not delivered by the present first-edit milestone.
