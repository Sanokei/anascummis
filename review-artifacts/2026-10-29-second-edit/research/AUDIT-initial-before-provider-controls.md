# Current-revision edit audit and native diagnostic

The accepted stopped phone fixture contains document `fd69d9b5-decb-422d-bbec-e44b724872e0`, current revision 1 and operation `331acb90-59c6-40ce-ab28-2d450e5491d8`. Its accepted edit goal is `539eb445-5070-4446-86a1-23ff9fa4df13`. It has exactly versions 0 and 1. The current summary is two source-quotation copies with user labels; the original 1,719-character notes and exact citations remain in provenance.

## One bounded result

Use the ordinary current-version action to request: **Shorten the current summary to one sentence for a newcomer; keep both exact locations and citations and do not change notes/evidence.** Produce actual native text fulfilling that unchanged goal, show readable rendered before/proposed text in a wide review dialog on desktop and stacked review on 360×420, then explicitly Apply version 2 of the same document. Keep versions 0/1, their exact files/provenance/raw responses and parent records unchanged. This remains structured-summary editing, not imported-PDF layout editing.

## Source-backed architectural seam

`ResearchBriefEditStore.prepare` currently accepts only a completed original `brief`, rejects any existing document edit and requires revision 0. `checkpoint`, `stateFrom`, `verifyOriginal`, `approve`, `paths`, `verify`, publication SQL and export names all pin 0/1. `GoalOrchestrator.createDocumentEdit` likewise requires the original source-brief artifact. The next child must pin the **accepted current edit artifact and proposal** as its base, separately retaining immutable original research. A generic PDF restore/manual edit advancing current revision must invalidate this stale base, not retarget it silently.

Use the same host document lock, conditional base-revision SQL registration and one operation-owned output folder. External files are not made atomic merely by a SQLite transaction; saved rendered state/hash checks remain necessary. GET inspection cannot submit work, approve a proposal or replay an uncertain Apply. Historical version exports must remain pinned even after version 2 becomes current.

Primary SQLite, Playwright, llama.cpp and Qwen documentation was read from the prior normally fetched cached bodies and each SHA-256 reverified in `primary-sources.json`. No source was refetched, no weight downloaded and no model parameter changed. Grammar constrains JSON syntax, not semantic goal fulfillment. Wait for actual browser Download/saveAs bytes; inspect MIME through a byte-identical exact-URL GET. The Qwen card recommends standardized prompts and non-thinking sampling different from the current deterministic T0; this is diagnostic context, not evidence that changing sampling fixes this goal.

## Bounded native diagnostics

The same real `infer` transport, installed Qwen PID 18848/start identity, local loopback endpoint and T0/2048/non-thinking configuration were used. Three calls were authorized and executed; all remain failed in `diagnostic/report.json` with the exact system/user/schema, raw JSON/hash and mechanical outcome checks. No database, UI, document, source file or application configuration was changed.

1. Current rendered summary with a leading/trailing exact rewrite request: retained two sentences and the Browser results label, plus stray inline citation/markup. Both locations were present, but the goal was unmet.
2. Both exact source quotes and a one-sentence/220-character output contract: began joining with “and” but ended before the browser-results URL or sentence punctuation. Schema-valid output was not a completed answer.
3. Current rendered summary in JSON with the exact one-sentence format: retained two sentences and the Browser results label. Shorter output alone was insufficient.

No host punctuation/joining/factual fallback is justified by those failures. Potential further diagnostics require the parent to select a strategy: for example, supply the earlier complete accepted factual answer as the writer's short evidence while retaining the actual v1 base/goal for final review, or measure an explicitly scoped decoding profile based on official guidance. Neither was run by this audit. The actual user goal must still pass ordinary UI/process/output acceptance; a prompt diagnostic cannot stand in for it.

## Lifecycle acceptance

Start from a fresh owned copy of this stopped accepted-v1 fixture, never normal user data. Inspect/download versions 0/1. Save the exact request and base identity; close/reload preserves draft. Lost create acknowledgement reconciles one child through GET. Inspect the actual native raw proposal and require one shorter sentence with both exact locations and original citation numbers. Stop/restart retains the saved response without regeneration. A lost explicit Apply acknowledgement and owned-host interruption must recover one operation/version 2 through read-only inspection and deliberate Continue. A second pending operation or manual edit that changes the base must cause stale-base rejection without overwriting versions 0/1/2. Verify actual PDF/HTML MIME/signature/full notes/citation links/byte hashes and historical pinned exports, with a small original 1440/360×420 comparison+Apply set and real keyboard/touch focus proof.
