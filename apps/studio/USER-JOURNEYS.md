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
| Build a counter application | Submit a real software request, retain progress across reload, and require the actual checked download. Independent interactive app acceptance is a separate required stage; absent execution proof remains blocked rather than being counted as an achieved goal. |

## Outcomes and evidence

The default command exits **0 only if every selected goal was achieved**, **1 for a failed assertion/setup**, and **2 for a blocked user goal**. A successful recovery assertion does not convert a blocked website edit, answer or app build into a completed goal. `--allow-blocked` is an explicit diagnostic option: it can return 0 while the report still says incomplete. `--require-model` additionally gates on local runtime readiness; a reachable health endpoint alone does not establish answer quality.

`test:local-ai` uses the application's actual configured local transport, tokenization and JSON generation to check two calculations without constraining the answer to the correct value. It exits 2 if the real service is unavailable and 1 for incorrect generation or a transport/schema failure. Passing it demonstrates that narrow inference path, not task accuracy or voice readiness. Install/start the real model before rerunning AI user journeys; no test-supplied model server is used.

Each timestamped `.test-data/user-journeys/` run contains `report.json`, a readable `report.html`, per-journey receipts, original screenshots, downloaded files and credential-redacted Playwright traces. Override the destination with `--output` and use a fresh directory for each run. Local `private-data/` databases and `host.log` are diagnostics, not fixtures to publish. Share selected synthetic receipts/screenshots only after reviewing them; do not publish private databases or original user files.

The suite reports native model/voice download or runtime limitations honestly. In this cloud environment the official model metadata endpoint currently returns Hugging Face 403 **Domain forbidden**, model weights are absent, and no AI service is listening. The saved draft's Hugging Face rule must be applied to the running environment through settings before official setup can proceed. File/preview tests can work while actual AI goals remain blocked. The production build and unit tests do not override that result.

## Adding a journey

Add a definition to `scripts/e2e/journeys.mjs` with a human goal and `run(context)`. Use visible buttons, typing, the real file picker and downloaded results. Use `readApi` to inspect the result, not to create the state that the UI should produce. Assert the requested content, behavior and persistence. Use `context.blocked` for an observed missing prerequisite after attempting the user path; don't silently skip hard stages or infer success from a status caption.

Keep external publication, payments, destructive operations and real personal data out of routine tests. Test-supplied model decisions belong in a separately labelled host-flow suite and cannot pass these native user-goal gates.
