# Task-list capability: source review and bounded acceptance plan

Status: design only. Source edits are held until the real native/UI baseline failure is preserved and the root agent approves the plan. Baseline branch is codex/task-list-e2e-20261029 (base c599); the existing model700, Studio17855, frozen kits and accepted parents are outside this slice.

## Existing gap

README explicitly calls current software behavior a bounded counter compiler rather than arbitrary generation. PROJECT-ROADMAP.md names add/remove/persistence plus independently run downloads and a child revision as the next software acceptance. core/react-screen.ts compiles only numeric state. SoftwareBrowserContract/worker/software-browser.mjs recognize counter and counter_absent only. The general worker has bounded 650-character reads and 1,600-character writes but no host-owned collection/persistence semantics. Existing copySoftwareRevisionWorkspace already creates an immutable child, copies validated QA contracts, excludes artifacts/caches, checks source hashes and preserves the accepted parent's downloads; reuse that mechanism.

## Primary sources and requirements

Exact URLs, retrieval times, byte sizes and SHA-256 are in sources.json; all six sources were retrieved normally over HTTPS with certificate validation, HTTP200.

- React useState: https://react.dev/reference/react/useState (official source react-useState.md). State initializers and updaters must be pure and can run twice in development. Array updates must replace rather than mutate state. Generate IDs and perform localStorage writes in explicit event handlers, not state updater functions.
- React useEffect: https://react.dev/reference/react/useEffect (official source react-useEffect.md, especially “Displaying different content on the server and the client”). Initial server/client render must match; localStorage cannot be read on the server. Use the same empty/loading initial render, then read existing storage on client mount before enabling edits. Do not run a default-empty persistence effect before the saved collection has loaded.
- WHATWG HTML Web Storage: https://html.spec.whatwg.org/multipage/webstorage.html (html-webstorage.html/text). localStorage belongs to the page's origin, is shared state without a promised locking mechanism, and may throw SecurityError or QuotaExceededError. Treat reload persistence at the same browser origin as the bounded guarantee; do not claim account sync, cross-device/port migration or concurrent-tab conflict resolution. Preserve malformed saved content and drafts on failure; surface a visible error rather than falsely showing a saved mutation.
- Playwright official locators: https://playwright.dev/docs/locators (official source playwright-locators.md). Prefer accessible roles/names and associated input labels. Check actual list items and each item's own Remove control rather than matching incidental page text.
- Next output docs: https://nextjs.org/docs/app/api-reference/config/next-config-js/output (official source next-output.mdx). Keep installed standalone workflow; its server needs copied .next/static/public. Source ZIP openability requires actually extracting, installing with the saved lock, building and running it, not only finding source filenames or trusting a generation log.
- Bun test docs: https://bun.sh/docs/test/writing-tests (official source bun-writing-tests.mdx). Await asynchronous tests and give bounded timeouts. Pure compiler/parser tests verify syntax and refusal boundaries; they do not substitute for actual browser interaction or native goal achievement.

## Proposed implementation boundaries

Own new core/collection-screen.ts and tests/collection-screen.test.ts; targeted software-task.ts recipe, typed-revision and completion gating; software-runner.ts SoftwareBrowserContract union/validation/revision derivation; worker/software-browser.mjs actual QA. Add focused contract/revision tests as required. Do not edit routing, UI/E2E owner files, manifests/lockfiles, providers, model processes, frozen kits or accepted task rows/artifacts.

The new compiler is a bounded persistent text-collection capability, not a one-heading answer and not arbitrary native code generation. A closed parser must consume the full supported request, capture literal heading/control labels as data, and reject any unsupported extra requirement. It supports an initially empty list, a labelled text draft, Add, per-item Remove, stable item IDs (including duplicate text), at most 100 items of 200 characters, and same-origin localStorage reload persistence. Empty text does not create an item. The literal heading can vary; My Tasks is just the baseline request. Model inference remains real and supplies a small typed behavior decision; host grounding/compilation is disclosed in BUILD-PROVENANCE.json and generated README. No model string is executable code.

Read browser storage only after client mount; validate versioned saved records, IDs, bounds and strings. Do not overwrite unparsed/unreadable saved records. Commit storage first inside the explicit Add/Remove event, then publish new React state; if writing fails retain the draft and prior visible collection with an actionable error. Keep a stable per-application storage key in the typed spec/provenance; a heading-only child inherits that key rather than deriving it from its new heading.

Host browser contract records heading, accessible input/Add/Remove/list labels, persistence kind and stable key/limits. QA must begin in a fresh browser context and verify exact H1, empty start, labelled input, blank rejection, adding distinct and duplicate values, removing only the selected item, preserving remaining items after reload, subsequent add/remove and reload persistence, no page errors, and captured DOM/screenshot. A passing generic page-load or stale counter contract cannot satisfy collection acceptance. Browser proof stores the actual normalized collection contract.

A bounded heading-only revision is allowed only for a known collection contract plus hash-matching typed provenance/source. Parse the full explicit revision guidance and preserve storage key and collection behavior. Compile only the requested heading change into the copied child, create fresh source tests/QA, clear stale evidence/artifacts through existing revision lifecycle, and retain visible parent-child links and original full guidance. Unsupported guidance falls back to the existing guarded worker/review path or pauses honestly; it must not gain complete host acceptance through this recipe. The completed child needs actual fresh collection QA, its own verified ZIP and full-guidance coverage; accepted parent source/artifact hashes remain unchanged.

## Concrete user-result acceptance

Original exact E2E request:
> Build a task-list application with heading My Tasks, a text input labelled New task, an Add button, and a Remove button for each task. Add task text to the list, remove individual tasks, and persist remaining tasks after a page reload. Include browser checks and give me the source ZIP.

Revision:
> Change heading to My Week; keep existing add/remove/persistence behavior.

1. Preserve the actual pre-fix native UI failure, exact goal, task ID, checks, progress and screenshots before editing.
2. Focused tests: parser full-consumption/refusal, alternate/literal headings/labels, duplicate-safe pure record validation, compiler type/syntax/render surface, contract normalization, heading-only amendment preserving controls/key, rejected unsupported changes, immutable parent fixture.
3. Actual Chromium fixtures: correct implementation passes; missing input/Add/per-item Remove, remove-all-duplicates bug, wrong heading and non-persistent implementation fail. A reload test must perform real user events and compare the actual rendered list afterward.
4. The independent E2E owner submits the unchanged goal through ordinary Studio UI using native model700, opens the produced app, adds/removes items, reloads, and downloads/checks the actual ZIP checksum. Extracted source is independently built/run and receives the same behavior checks.
5. Through UI create the requested child; independently require My Week plus the full collection behavior. Download/run child ZIP. Compare accepted parent source and ZIP hashes before/after and inspect visible lineage. Failed/blocked goals remain unfinished; do not relabel recovery as goal completion.

Implementation is not approved by this document; root approval and the preserved baseline remain prerequisites.
