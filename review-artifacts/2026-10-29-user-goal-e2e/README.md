# Real user goals with local Qwen

The actual local-AI user journeys now pass: **10 achieved, 0 blocked, 0 failed**, with 38 independent assertions and the real `--require-model` command exiting 0. No inference/API responses were substituted. Earlier blocked and failed results are preserved separately.

Source checkpoint: [`bd1f47213f0eff8ce1685a041782910ebd9e73a1`](https://github.com/Sanokei/anascummis/commit/bd1f47213f0eff8ce1685a041782910ebd9e73a1), tree `af8219e52d0520fa138a7089958ea6dff288646f`, branch `codex/user-goal-e2e-20261029`. Base: `6a3710921669c27a2c1e85d495eab568f74d32af`. The implementation was committed at `94359302f9d43e02f7d6dc381ccba777c4aefd87`; subsequent changes only update installation documentation and include the test guide in Download. [Exact paths/provenance](source.json), [original native report](native/report.json), [post-run hash/trace verification](native/post-validation.json).

## User outcomes

| Goal entered through the ordinary UI | Desktop | 360px | Independent acceptance |
| --- | --- | --- | --- |
| Discover useful actions | Passed | Passed | “What can you do?” exposes labelled actions opening the existing Goals, Work and Software windows without starting unwanted tasks. |
| Personalize a bakery website | Passed | Passed | Real Qwen delegation/arguments; exact title/subtitle saved, other content preserved, preview/reload and downloaded ZIP checked. |
| Keep a PDF open and export the intended file | Passed | Passed | Actual picker/PDF rendering; real website HTML/ZIP and PDF/PNG bytes; downloaded HTML rendered independently. A missing PDF produces an error and keeps the request instead of downloading another artifact. |
| Answer from a public document | Passed | Passed | Real fetch and Qwen answer; expected Fetch Standard fact, supporting literal quote, offsets/hash/source identity, coherent uncertainty and retained visible answer after reload. |
| Build a counter and get its source | Passed | Passed | Exact heading; actual install/typecheck/tests/build/browser/clean-source QA; accepted ZIP downloaded and SHA checked. Separately launched produced bundle: Increment 0→1→2, Reset→0, reload→0. |

The counter uses **one native planning call plus a trusted typed compiler for a conservatively recognized counter contract**. It is not proof of arbitrary model-written applications. Exact copy operations similarly ground user-supplied literal content in host contracts while using real native delegation/argument calls. The independently launched counter uses the produced standalone bundle, not a fresh installation of the downloaded ZIP.

## Fixes exposed by the journeys

- [Before: real website requests downloaded PDF bytes](before/wrong-export-receipt.json). Explicit website HTML/ZIP requests both returned the open invoice PDF while the UI claimed success. Target and format are now preserved; HTML embeds uploaded images; unsupported formats fail clearly. The suite inspects actual signatures/content/openability, not filenames or success text.
- [Before: website delegated to software](before/native-assistant-diagnosis.json). The available-agent descriptions were hidden behind a partial memory catalog. A compact full-request/agent/dependency handoff and complete literal-copy acceptance prevent wrong specialists, greedy compound values and premature completion.
- [Before: missing Reset and wrong heading](before/native-software-diagnosis.json). The numeric-screen compiler lacked Reset. It now supports an optional Reset control, literal headings and fresh complete browser receipts. Old Increment-only proof cannot certify newly recognized heading/Reset requirements. Unsupported extra features remain outside the closed recipe. Linux defaults to a usable ZIP rather than requiring an unwanted Windows executable.
- [Before: correct citation contradicted by “source not provided”](before/source-first.json). Concise source-first prompting retains useful missing-fact uncertainty. A metadata-coherence guard rejects a claim that the supplied source itself is missing. The stronger user-goal assertion remains in the suite.
- [Before: test guide missing from Download](before/missing-guide-failure.log). The current source kit now requires and includes `USER-JOURNEYS.md`; the real downloaded archive was rechecked.

## Native setup and test evidence

Initial access returned [HTTP 403 “Domain forbidden”](before/blocked-model-metadata.json). After the human applied network settings and reconnected the execution environment, the official model metadata returned 200. Standard setup downloaded and verified:

```text
ggml-org/Qwen3-0.6B-GGUF
revision 13ac06624948e4d8589cb4b6f90100837342fcb8
Qwen3-0.6B-Q4_0.gguf — 428,970,080 bytes
SHA-256 da2572f16c06133561ce56accaa822216f2391ef4d37fba427801cd6736417d4
```

The actual llama.cpp CPU service uses four threads, context 2048 and one resident slot. A repeated setup reused identical weights without another weight transfer. [Model identity](validation/model-identity.json), [setup](validation/model-setup.log), [cached repeat](validation/model-setup-repeat.log).

[Actual native checks](validation/native-check.json) passed 23+19=42, 9−14=−5, 22−30=−8 and 7−12=−5 through the application's real tokenization/generation transport. The initial subtraction failure is retained; a general instruction to return the calculated result rather than echo an operand was tested with unchanged expected answers, a permissive integer schema, no answer examples/enums and held-out negatives. [Raw arithmetic experiment](diagnostics/arithmetic-prompt-experiment.json), [source prompt experiment including absent-fact question](diagnostics/source-prompt-experiment.json).

[Affected checks](validation/affected-tests.log): 95 tests/515 assertions across 11 files, plus [one counter-contract test/3 assertions](validation/counter-contract-tests.log). [Studio TypeScript](validation/typecheck.log) and [production build](validation/build.log) exited 0. These are separate from the real native browser results. Earlier scripted host-flow packs are not relabelled as native evidence.

The original report was captured while the working tree was dirty at `f4be39c`. All 4 runner, 21 critical application and 88 served-build SHA fingerprints match the final committed implementation. The final trace/download validation covers 12 downloads and 12 redacted browser traces. Large full trace archives remain in the ignored local run directory; [their byte counts/SHA identities](native/trace-inventory.json) are published without embedding runtime resources/private databases in this pack.

## Original previews and usable outputs

No public deployment or loopback preview link is claimed. These private-repository PNGs are the original source-pinned review preview; there is no compositing or image editing.

| Preview | Desktop | Narrow |
| --- | --- | --- |
| First useful actions | [Getting started](native/discover-capabilities-desktop/02-capabilities.png) | [Getting started](native/discover-capabilities-narrow/02-capabilities.png) |
| Saved website edit | [Actual preview](native/bakery-website-desktop/02-personalized-website.png) | [Actual preview](native/bakery-website-narrow/02-personalized-website.png) |
| Exported website | [Rendered downloaded HTML](native/website-pdf-exports-desktop/rendered-downloaded-website.png) | [Rendered downloaded HTML](native/website-pdf-exports-narrow/rendered-downloaded-website.png) |
| Source answer after reload | [Persisted answer](native/public-source-answer-desktop/03-source-grounded-answer-after-reload.png), [uncertainty/limit](native/public-source-answer-desktop/04-source-answer-uncertainty-and-limit.png) | [Persisted answer](native/public-source-answer-narrow/03-source-grounded-answer-after-reload.png), [uncertainty/limit](native/public-source-answer-narrow/04-source-answer-uncertainty-and-limit.png) |
| Counter actual app | [Produced app](native/counter-application-desktop/produced-counter.png) | [Produced app](native/counter-application-narrow/produced-counter.png) |
| Current Download | [Version/provenance](kit/current-kit-desktop.png) | [Version/provenance](kit/current-kit-narrow.png) |

Actual exported HTML/ZIP/PDF/PNG and counter source ZIPs are beside their per-goal receipts under `native/`. The complete local interactive report is `apps/studio/.test-data/user-journeys/native-final-gated/report.html`; its trace links remain local. All inputs were synthetic test content or the public WHATWG source, never real private user documents.

## Current kit and restart

[Current source ZIP](kit/anascummis-studio-e3e76d87cf900de9.zip), [manifest](kit/manifest.json), [actual Download receipt](kit/browser-receipt.json): 218 payload files, 1,393,277 bytes, source `bd1f4721`, version `e3e76d87cf900de9`.

```text
ZIP SHA-256 274c19938daa74708b91b9dfedf49886880be17a513ffb14d0bbc72fc9d183e2
```

It includes the current user-goal tests/guide, lockfile, existing licenses and source; excludes models, databases, credentials and caches. This current-kit check covers real Download/checksum/contents and desktop/narrow controls. It is not a new fresh-online installation or a native Windows/macOS pass. The previous frozen 199-file kit remains unchanged in its earlier checkpoint.

In the prepared environment, initialize each shell and keep model and Studio in separate sessions:

```sh
source /workspace/.cloud-env/anascummis/env.sh
cd /workspace/anascummis/apps/studio
bun run model:start
```

```sh
source /workspace/.cloud-env/anascummis/env.sh
bash /workspace/.cloud-env/anascummis/start.sh
```

```sh
cd /workspace/anascummis/apps/studio
bun run test:local-ai
bun run test:e2e --viewport all --require-model
```

Reuse an already healthy owned service; do not start duplicates. Files/verified weights can persist across snapshots, while processes must restart when absent. Updated complete startup instructions were saved to the environment draft; installer and user-applied network settings were preserved.

[Preservation checks](validation/preservation.json) confirm accepted parent source/records/ZIPs, previous review manifest and frozen kit are intact. Main remains `df70f5ccdb9c3474f04d3f83ad7f60a8f7ecf917`. No main promotion, public deployment, new secret or alternate-provider/TLS workaround occurred. Native voice/microphone/physical-device behavior, Windows executables, unrestricted software generation and general factual/reasoning accuracy remain unverified.
