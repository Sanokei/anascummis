# Independent audit: native edit quality and the two-label contract

Audit started from source `b5b3ddb55139c974bf1b4ef8bb1eaa18bcc635b4`. The optional two-label implementation was still in progress; this document distinguishes measured failures, proposed structural controls and actual native semantic acceptance. No app source or driver was changed by this audit.

## What actually failed

I read `native-fixed-desktop/failure-analysis.json` and the current edit store. The genuine native response retained the Fetch test directory and browser-results location but returned one paragraph beginning only `Tests:`. The exact user intent also required a second sentence beginning `Browser results:`. The model reviewer nevertheless asserted that both labels were present. The operation reached `awaiting_approval`, but the goal-driven test failed before Apply; no approved proposal, revised PDF/HTML or quality success resulted. Retain this as an unmet native edit goal, not as a passing recovery test relabelled as quality.

The failed response's original SHA-256 is `33bf15baaab4589aab0c489ad45c778f7ccc02c93da9c0e07d5b7c20b982c263`. The preserved failure also records its operation identity, unchanged original fixture and the separately successful Stop/proposal interruption behavior. Persistence success does not cure the unmet edit intent.

## Primary-source basis

I read the already retrieved official [llama.cpp GBNF guide](https://raw.githubusercontent.com/ggml-org/llama.cpp/master/grammars/README.md), exact cached body SHA-256 `e1874c0f08abbcfe45eff0b7b0290faa58f630981bf94274e2d99751ef3b0208` (18,051 bytes). It describes formal grammar as a constraint on allowed output syntax, supports a subset of JSON Schema and warns that unsupported features may be skipped. Its JSON Schema section explicitly says the schema constrains output and is **not injected into the prompt**; expected structure must also be explained in the prompt. Nothing in that mechanism independently verifies source claims, instruction fulfillment or semantic completeness.

The actual `core/model.ts` sends a JSON-schema response format to the existing local runtime and separately describes its role/prompt. Its tokenizer/context/output guards are operational limits, not factual checks. No runtime/model download or provider change is needed for the bounded formatting improvement.

## Legitimate host contribution

An **explicit user-selected** two-label mode can ask the native model for first and second factual text fields. The host may deterministically add the user's exact labels and combine the two fields into one proposal. This enforces a disclosed presentation choice; it must not hard-code the correct Fetch facts or replace failed model wording with a trusted answer. The ordinary freeform intent remains a different contract. User format fields, original raw native JSON, projection method, proposal hash and exact approval must be retained and reconstructed on retry.

Two required text fields prove that two parts were supplied. They do not prove that each part contains exactly one grammatical sentence, that each covers its requested topic, or that the two parts preserve all source facts. A model may repeat one fact twice, put the browser location under the wrong label, invent a claim using an already allowed URL, or receive a false-positive review from the same small model. JSON/citation validity and literal source identity are useful separate checks, not semantic guarantees.

The explicit before/after approval is therefore necessary. The app must qualify the native support review and leave raw evidence inspectable. A goal-based native test must independently check the **specific requested result** against the retrieved source and actual proposal before Apply; a format-only pass must never become a claimed complete edit.

## Concrete host-validation boundary found

`core/harness.ts:validate()` does not enforce string `minLength`; its string branch delegates only to `text(value,maxLength)`, which accepts empty strings. In a new two-label projection, a blank native field can be hidden by the host-supplied label, making the final paragraph nonempty. The new mode needs explicit non-whitespace checks on **each raw native text field before projection**. I sent this concrete finding to the backend owner; a schema `minLength:1` alone is insufficient host validation. Citation uniqueness, exact allowed IDs, raw/projection hashes, unchanged notes and foreign-source URL checks remain separate required invariants.

## Acceptance boundary for the new attempt

- Enter the user's format fields in ordinary UI, save/reload the draft and uncertain submission without changing the exact intent or reusing an identity for changed fields.
- Preserve the real raw structured native decision. Reconstruct the proposed paragraph deterministically from only that response and the user-selected labels. Empty/missing/whitespace fields must be rejected before support review/Apply; malformed or changed fields stay inspectable without silent regeneration.
- Inspect the actual native wording: the first requested label introduces the correct test location, the second the correct browser-results location; neither fact is omitted/repeated in place of the other, and original citation numbers remain. This bounded observation does not establish general source accuracy.
- Confirm that host checks describe structural/identity constraints only. A passing same-model review is qualified. If real native wording still fails the requested result, the journey remains failed/needs attention and is not approved for a screenshot success.
- Keep the already accepted historical PDF/HTML, complete 1,719-character personal note and raw quotations byte-for-byte preserved. Inspect actual revised PDF/HTML and separate provenance only after explicit exact-proposal approval, with one durable operation/version through interruption and uncertain delivery.

## Inspection of the in-progress correction

I independently read the additive backend, server/orchestrator identity changes, browser draft handling, UI and new focused cases after the owners implemented the contract. The new `DOCUMENT_EDIT_LABELLED_ROLE` describes the first/second object structure in the actual prompt as required by the official grammar documentation. `project()` checks each native field for non-whitespace text, trailing sentence punctuation, the bounded single-sentence punctuation heuristic, no duplicated supplied label, no duplicated citation and no identical pair. It adds only the exact user labels, outer-whitespace trimming, one separating space and the union of native-selected citation numbers; it contains no Fetch location constants or replacement factual answer.

The raw decision and its hash remain separate from the proposal and a versioned `brief-labelled-sentences-v1` projection. Reading a saved state reconstructs the proposal from the original raw response and immutable request, and verifies both projection identities. Optional labels are part of server-side duplicate-delivery equality, so reusing a request identity with different labels is refused. The new literal-prefix guard also checks the old quoted-label freeform intent: the b5 missing-prefix proposal cannot be approved merely because its older saved check was accepted. Existing stopped/approval/version guards remain in place.

A second concrete mismatch was found and fixed by the UI owner: its initial label validator accepted outer whitespace while the backend rejected it. A read-only reproduction after the fix using `[' Tests:', 'Browser results:']` returned `uiValid:false`, rejected browser submission before save, and retained the exact draft string. The form now explains that leading/trailing spaces are unsupported instead of silently trimming them. Enabled/unchecked labels, incomplete unsent labels and the original submitted format are stored separately, and the displayed proposal identifies the host formatting contribution in an explicit detail section.

The punctuation rule is a bounded format heuristic, not an English parser. Different model wording can still satisfy the structure while omitting/misassigning facts; semantic support remains a model review plus explicit human inspection and the specific native goal acceptance. This audit found no additional concrete publication/identity defect in this correction. The owners' affected tests and a fresh genuine native journey still determine the final measured result. No model quality success is inferred from this source inspection or from injected test responses. The v2 PDF/HTML renderer was unchanged by this contract correction.
