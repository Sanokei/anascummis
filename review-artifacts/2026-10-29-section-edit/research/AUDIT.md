# Section-aware personal-note editing: baseline and actual native diagnostics

Baseline source: `dc1885c9e36738a4a4061f7d916ca074b7e2144a`. This is a gap/primary-document audit, not acceptance of the concurrently edited implementation. The audit made no repository source changes, database writes, model downloads or service changes.

## Actual selected input

The stopped real accepted version-2 fixture has parent goal `df0fdfbd-1bc8-43fd-bad9-92723e6ce775`, operation `705dfa96-c28b-43a1-8857-f5e45b58ccff` and document `fd69d9b5-decb-422d-bbec-e44b724872e0`. Its complete personal notes are 1,719 characters. The second blank-line paragraph is exactly **240 characters**, range `[161,401)` in the existing JavaScript string, SHA-256 `f728b3a1705eaaa90075d3b17a8b52a2304d5cf0883ea9b631edcd211be76501`:

> Before changing anything, I will record the browser and version, a minimal public example, the outcome I expected and what I actually saw. I will remove cookies, authorization headers, account details and private URLs from anything I share.

The original user request remains **Make this clearer for a newcomer**. The explicit clarification chooses personal notes / paragraph 2 / one plain paragraph, preserving all planned actions, meaning and future tense. It does not silently become a shorter-one-sentence request. The early informal 232-character count was wrong; diagnostics read the actual exact 240-character input and the error was corrected immediately.

## Source seams that must change coherently

The old `prepare`, browser `submit` and server whitelist only accept summary intent/optional labels. `DocumentEditRequest`, browser draft/submission equality and request-key reconciliation do not yet bind section, paragraph or format. Both clarification and uncertain delivery need that identity: a changed selection with the same request key cannot resolve to another saved target.

`preserved()` always copies original notes; `stateFrom()` enforces that original snapshot. `EditBase` pins only the current factual summary, and `plan()` renders original notes. A new note path therefore needs separately pinned **effective current notes**, exact selected paragraph range/hash and native replacement/output notes, while retaining original notes in historical provenance. Otherwise a later edit can silently restore the original notes over an accepted note change.

For notes, the approval hash must cover the actual note replacement and selected target. Hashing only the unchanged summary `BriefDraft` is insufficient. Host projection may copy exact prefix/suffix and insert exact native bytes; it may not author or repair the rewrite. Recursive base verification, conditional publication, shared abortable locking, raw-decision reuse and explicit Apply remain the existing recovery mechanism. Legacy mode serialization/render plans must remain byte-identical for accepted old versions.

Notes are personal intentions, not source facts. Their reviewer needs the original request, explicit target/format and exact before/proposed plans. It must check recording **before changes**, all information to record, every privacy-removal item and sharing scope, first-person future intention and no invented completed actions. Literal/schema/word-difference checks are insufficient, as the actual diagnostics demonstrate.

## Primary-source basis

`primary-sources.json` revalidates cached SQLite transaction, Playwright download, llama.cpp grammar and official Qwen card bodies against their saved SHA-256. The official card recommends non-thinking temperature 0.7 / top-p 0.8 / top-k 20 / min-p 0 and distinguishes hard `enable_thinking=false` from soft prompt tags. Seed 42 is the application's local reproducibility choice, not an official recommendation. JSON syntax constraints do not prove intended meaning.

The freshly fetched W3C WCAG 2.2 Understanding 3.2.2 **On Input** says changing a control's setting must not unexpectedly change context, and explicitly discusses checkbox/radio/select setting changes versus activated buttons. Section/format selection can update the local preview/draft but must not silently submit, approve or start native editing. SQLite transactions do not make external PDF/HTML file writes atomic; retained operation-owned files and conditional registration remain necessary. Playwright requires waiting for the actual download and saving/opening its bytes.

## Eleven preserved native failures

All calls use the same resident Qwen/runtime. Calls 1–6, 8, 9 and 11 use the existing document-only sampling profile; call 7 is one separately authorized predetermined seed42→0 control of exact call 2. Call 10 is a separately authorized official-thinking-mode request described below. Application/default profiles remain unchanged. Exact system/user/schema/profile/raw response, selected base and process identity are saved under `diagnostics/`. No test-supplied answer/example or host-written replacement was supplied.

1. Whole-paragraph rewrite: native output only adds an Oxford comma after `account details` (241 characters). It preserves plans but does not meaningfully clarify wording.
2. Stronger genuine-rephrase role: byte-identical output to call 1. A punctuation-sensitive `newWording:true` mechanical check is a false indicator of goal achievement. The independent critique records this.
3. Native-selected span patch: native selects the complete first sentence and only removes `Before changing anything,`. Unique-span assembly works mechanically, but recording-before-changes meaning is lost. The host did not restore that condition.
4. Planning-first paragraph: native planning and final text omit recording both the expected outcome and actual observation. The `beforeChanges` plan reaches its 140-character bound and ends with `any私`. Structured plans and a changed word sequence are not semantic success.

5. Sentence-unit decomposition: `Intl.Segmenter` chooses the original long first sentence while the exact original privacy sentence is kept. Native output remains one longer sentence and changes recording expected/actual outcomes into a future `observe` action. The host does not repair it.

6. Privacy-unit decomposition: the exact long recording sentence and separator stay unchanged. Native output for the privacy sentence again only adds an Oxford comma and does not put the sharing condition first. Meaning survives; clarity/rephrasing does not.

7. Seed control: diagnostic2 system/user/schema/outputbudget are held constant and only request seed42 becomes0, chosen before seeing output. Native text drops the before-changing condition, retaining most wording with an extra conjunction/comma. HTTP200/stop and the identical227-token input count show this is not a setup/budget failure. A changed trajectory did not solve the goal; no multi-seed search followed.

8. Recency control: exact diagnostic2 system/schema/profile(seed42)/source data are retained, with a final request/action reminder appended after the source. The actual provider request is captured. Output again only adds the same Oxford comma. This prompt placement change does not establish a clearer rewrite.

9. Plain-protocol control: the same goal/source/profile/outputbudget are retained, structured response_format is removed, and JSON-return instructions become plain-paragraph instructions. Exact provider prose is preserved without parsing/repair. Output omits expected/observed recording details and adds rewrite-instruction commentary as personal-plan text. Removing grammar changes the output but does not solve the goal.

10. Official-thinking-mode request: the cached official Qwen card and exact runtime docs are hash-reverified. Request uses enable_thinking=true, reasoning_format=deepseek, T0.6/P0.95/K20/minP0/seed42 and1024output tokens, with /think and no /no_think. It fits1376/2048 before sending. Provider reasoning_content is nonempty1291characters and final response stops normally, proving thinking was actually exercised on the same process. Final JSON only merges both original sentences into one long sentence, with no simpler wording and ambiguous expanded timing scope. It does not satisfy the clearer-for-newcomer goal.

11. Unrelated host-authored style example: one explicitly separated station/train/wallet example teaches paraphrase without supplying browser/privacy target wording. Exact actual user request/paragraph/schema/profile remain unchanged. Native output only changes changing→doing in the timing phrase and adds an Oxford comma; all other lexical words/order are copied. No example facts contaminate the output, but the tiny synonym change is not a substantive clarity improvement. The example is host guidance input, never native factual output.

These are **eleven unachieved prompt diagnostics**, not completed UI jobs or document edits. `diagnostic-assessments.json` preserves manual classifications and raw hashes. Calls 1–9 use 384 output tokens plus a 128-token safety margin; their total application budgets are 712, 739, 749, 758, 784, 765, 739, 800 and 804. Call 10 uses 224 input + 1,024 output + 128 margin = 1,376, below the unchanged 2,048 context limit. Its provider actually reports 237 prompt + 320 completion = 557 tokens. Call 11 uses 397 input + 384 output + 128 margin = 909 tokens. Application concatenation counts are distinguished from provider chat-template counts. No further native generations are authorized to this audit without another explicit parent instruction.

An independent child critiqued the first two raw outputs. Triggering its later span follow-up returned `collab tool failed: agent thread limit reached`; the third/fourth critique was performed manually and reported to the parent. This tooling limit did not restart or change any healthy model/server process.


After diagnostic 9, the parent instructed this audit to stop further calls if the goal remained unachieved. That boundary was preserved until the separately authorized primary-doc-backed call 10 described next.


After the nine failed controls, the parent separately authorized the one primary-doc-backed thinking-mode diagnostic10. Its real provider evidence is kept; the requested clarity result still fails. The parent instruction is now to stop prompt variation and test the actual blocked UI, with no further generation by this audit.


After the actual ea1001 NOTE-role goal failed (owner evidence, distinct from these diagnostics), the parent separately authorized one unrelated in-context style-example diagnostic 11. It also failed to produce a substantive clearer rewrite. No further prompt ideas, seed search, target wording or native generations are performed by this audit.
