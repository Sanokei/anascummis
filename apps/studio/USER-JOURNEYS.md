# End-to-end user goals

Run these against the real production Studio with an installed Bun, Node, Chrome/Chromium and the existing Python/PyMuPDF setup. The runner starts and stops its own backend with isolated data for each journey. It does not alter your real workspaces, inject model answers, seed task records through APIs, or download browsers/models. Browser actions enter the request; API reads independently check persisted output. Downloads are inspected for actual content.

```sh
# After building the production UI:
bun run test:e2e

# Check actual local inference first (no download or scripted replacement):
bun run test:local-ai

# A focused desktop or phone-sized journey:
bun run test:e2e --journey website-pdf-exports --viewport narrow
bun run test:e2e --journey discover-capabilities --viewport desktop
bun run test:e2e --journey task-list-application --viewport narrow --require-model

# A fresh research → cited document goal, including actual owned-host interruption:
bun run test:e2e:research-document --viewport all --output .test-data/user-journeys/research-document-NEW

# Edit an explicitly selected stopped, previously native-generated brief:
bun run test:e2e:research-document-edit --fixture /absolute/path/to/stopped/brief-data --viewport all --output .test-data/user-journeys/research-document-edit-NEW

# Rewrite the current accepted version 1, preserving its complete earlier lineage:
bun run test:e2e:research-document-second-edit --fixture /absolute/path/to/stopped/accepted-v1-data --viewport desktop --output .test-data/user-journeys/second-edit-NEW

# Experimental selected-note rewrite from a stopped accepted version-2 checkpoint:
bun run test:e2e:research-document-note-edit --fixture /absolute/path/to/stopped/accepted-v2-data --viewport desktop --output .test-data/user-journeys/note-edit-NEW

# List goals and options:
bun run test:e2e --list
bun run test:e2e --help
```

Use `CHROME_PATH` if Chrome is outside the detected platform paths, `BUN_PATH` if Bun is not on PATH, and the supported `PYTHON_PATH` for PDF rendering. The runner respects an already configured local `MODEL_URL`. It never starts a test-supplied inference server. Native voice/microphone quality is outside these typed user journeys.

| User goal | End-to-end acceptance |
| --- | --- |
| Discover useful actions | Type **What can you do?**, find labelled actions and open the existing Goals, Work and Software windows without creating unwanted tasks. |
| Personalize a bakery website | Submit the full request, check exact requested title/subtitle in the preview, reload, and inspect the actual exported ZIP. If AI is unavailable, check recovery separately and mark the user goal blocked. |
| Export the intended file | Start with a missing-PDF request and require a clear error with no wrong download. Open a real PDF via the picker; preview the website; obtain actual website HTML/ZIP and PDF/PNG, without confusing their targets or editing the original. |
| Answer from a public source | Submit a focused question and public URL through Goals; inspect retained source identity, reload, and require an actual answer with literal source citations. Source retention alone is not an answered question. |
| Read later evidence and follow up | Ask for two facts beyond the opening excerpt, inspect the persisted reading and exact citations, then explicitly ask a linked question from the saved copies. Require both real answers, no refetch or parent change, and an unsupported-address control that stays unfinished. |
| Build a counter application | Submit the real goal, inspect the actual produced app and independently rebuild/start its downloaded ZIP. Check exact heading, visible Count label, comfortable controls, touch, keyboard focus/feedback, Increment/Reset and reload behavior. |
| Build and revise a persistent task list | Use the ordinary message field; require the complete saved goal, actual Add/Remove/duplicate handling and reload persistence. Rebuild/start both parent and child downloaded ZIPs. A separate My Week revision preserves the parent and existing browser items when replacing it at the same origin. |
| Find Software controls honestly | Status/history commands stay read-only. Untargeted edits and app-launch requests open the existing controls/instructions without pretending to revise or launch anything. This diagnostic does not require inference. |
| Use a checked app in its work window | Separate copied-checkpoint suite: visible Start/Stop, actual embedded app behavior and source identity, saved items across restart/reconnect and compatible child use, collision refusal, uncertain transport and usable 360px/short controls. It uses previously native-generated work and installed dependencies. |

The supported task-list example and its bounds are in [SOFTWARE.md](SOFTWARE.md#bounded-persistent-task-list). It is a trusted typed compiler workflow, not unrestricted source generation. The separately invoked `scripts/e2e/recover-software.mjs` diagnostic continues a **copy of an actual stopped native-generated checkpoint** through one explicit Resume; it is not a fresh generation or part of the fresh-user matrix.

The separate `scripts/e2e/app-launch.mjs` suite copies stopped, previously native-generated accepted counter/task-list checkpoints and uses the product's visible **Start app**, iframe, **Stop running app** and status controls. It checks actual use, close/reopen/reload without another launch, host interruption and explicit same-address continuation, compatible child replacement, saved items and immutable accepted artifacts. Its fixed React runtime executes the actual accepted client page, not the packaged Next server. Matching installed dependencies are reused; no new inference, API-seeded tasks or dependency installation is claimed. Use a fresh output folder and retained local fixtures; `--collection-fixture`, `--parent`, `--child`, `--counter-fixture` and `--counter` select them. Fixture databases and local logs stay private.

The separate `test:e2e:research-document` suite begins with fresh private data and a real public-source question. It requires genuine native answer and writing decisions, creates a linked brief through the visible **Create research brief** form, and checks saved notes, source attribution and actual PDF/HTML downloads. The child reuses the complete accepted answer and hash-checked source copies. Its fixed host renderer creates document files; it does not execute model-written code. The suite deliberately stops/restarts only its own Studio processes and requires explicit continuation with the accepted parent and saved writing unchanged. Choose a fresh output folder. A blocked or incorrect native answer/document is an unmet user goal, even when recovery works.

The separate `test:e2e:research-document-edit` suite copies a stopped, previously accepted native two-page brief into fresh owned data. It requires new genuine local edit/support decisions through **Edit brief**, an inspectable before/after proposal, and explicit **Apply proposed edit**. It checks uncertain create/apply acknowledgement recovery, Stop, forced/graceful owned-host restart, a single operation/revision, unchanged original files and all personal notes/citations, actual PDF/HTML bytes and separate raw provenance. The new presentation may reflow the original two-page document into one readable page; this is not fixed-layout editing. This first-edit suite starts from an unchanged original structured research brief. It never refetches the prior research or injects replacement model answers. Browser touch and short-window checks do not establish physical-device behavior.

The separate `test:e2e:research-document-second-edit` suite starts from a stopped, genuinely accepted version-1 checkpoint. Through **Edit current brief**, it requests a shorter single sentence while retaining both exact locations, citations and complete notes. The current-summary writer and experimental selected-note writer use the pinned Qwen non-thinking profile recorded in their operations; default inference and support-review roles remain unchanged. The suite checks the exact native response, expanded rendered comparison, explicit Apply, saved-decision interruption and continuation, lost acknowledgements, one version 2 and unchanged historical exports. A deliberately competing proposal tests stale-base rejection; it is a negative API case, not another completed user goal. Run desktop first and inspect its actual text/PDF before repeating with `--viewport narrow` (360×420). A rewrite that fails the actual intent remains an unmet goal. This is bounded structured-summary rewriting, not arbitrary PDF editing or independently verified semantic accuracy.

The experimental `test:e2e:research-document-note-edit` suite preserves the original request **Make this clearer for a newcomer**, requires explicit Personal notes/paragraph/format clarification before submission, and attempts a genuine local rewrite of one selected paragraph. Missing or contradictory choices keep the browser draft and create no child. A proposed note must preserve planned actions, timing and meaning; a punctuation-only response is a failed goal. The successful-path assertions require explicit Apply, one next version and real PDF/HTML with the summary, all unselected note bytes, citations and historical versions unchanged. If native writing or review fails, the suite exits nonzero and retains the exact request/target/raw response, needs-input UI and lack of a new version. Recovery checks or valid JSON do not turn that into an achieved edit. Early native diagnostics failed this goal; see the section-edit review checkpoint for the actual ordinary-server outcome before claiming support. Use a fresh output directory and inspect desktop before repeating narrow tests; no model answers, accepted state or document output are injected by this native runner.

For a two-sentence format, explicitly select **Two labelled sentences** and supply **First sentence label** and **Second sentence label** alongside the exact edit intent. The host ranks saved literal quotations by label-word overlap, records every candidate/score/source identity, and supplies one matching quote per native writing step. This is host retrieval, not model evidence choice; a missing match needs a more precise label. Qwen writes or copies a factual sentence from that quote, with its citation identity restricted to the supplied source. Each response is saved before the next starts, and Continue reuses it. The separate acceptance role receives the full intent, original summary, accepted answer and all quotations. Full notes and reading provenance remain preserved. Host formatting adds your exact labels and can remove one redundant identical prefix. **Host citation matching**, **Host sentence formatting** and **Edit operation and native decision** expose the selection, projection, unchanged individual responses and aggregate. These checks do not independently certify facts. Earlier native selection/writing failures and a false-positive support review remain failed evidence.

## Outcomes and evidence

The default command exits **0 only if every selected goal was achieved**, **1 for a failed assertion/setup**, and **2 for a blocked user goal**. A successful recovery assertion does not convert a blocked website edit, answer or app build into a completed goal. `--allow-blocked` is an explicit diagnostic option: it can return 0 while the report still says incomplete. `--require-model` additionally gates on local runtime readiness; a reachable health endpoint alone does not establish answer quality.

`test:local-ai` uses the application's actual configured local transport, tokenization and JSON generation to check four calculations without constraining the answer to the correct value. It exits 2 if the real service is unavailable and 1 for incorrect generation or a transport/schema failure. Passing it demonstrates that narrow inference path, not task accuracy or voice readiness. Install/start the real model before rerunning AI user journeys; no test-supplied model server is used.

Each timestamped `.test-data/user-journeys/` run contains `report.json`, a readable `report.html`, per-journey receipts, original screenshots, downloaded files and credential-redacted Playwright traces. Override the destination with `--output` and use a fresh directory for each run. Local `private-data/` databases and `host.log` are diagnostics, not fixtures to publish. Share selected synthetic receipts/screenshots only after reviewing them; do not publish private databases or original user files.

The suite reports native model/voice download or runtime limitations honestly. Initial cloud tests were blocked by Hugging Face 403 **Domain forbidden**. After the user applied network access, the official Qwen weights were downloaded and checksum-verified, and actual local inference/user-goal tests could run. Keep the earlier blocked/failed evidence; don't relabel it as native success. Voice initialization, physical-device behavior and arbitrary model accuracy require separate checks. The production build and unit tests do not override the actual journey result.

## Adding a journey

Add a definition to `scripts/e2e/journeys.mjs` with a human goal and `run(context)`. Use visible buttons, typing, the real file picker and downloaded results. Use `readApi` to inspect the result, not to create the state that the UI should produce. Assert the requested content, behavior and persistence. Use `context.blocked` for an observed missing prerequisite after attempting the user path; don't silently skip hard stages or infer success from a status caption.

Keep external publication, payments, destructive operations and real personal data out of routine tests. Test-supplied model decisions belong in a separately labelled host-flow suite and cannot pass these native user-goal gates.
