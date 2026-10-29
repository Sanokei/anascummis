# First-use typing and safe request recovery — 2026-10-29

A new phone user can now tap **Type a message**, see actual local AI/voice readiness, open the existing setup instructions, and recover a failed Work request without retyping. Editing restores its original website/PDF and prepares an explicit new attempt. It preserves the earlier record, activity and any changes already applied. The next observed gap is also fixed: delayed Goal/Software submissions preserve newer form edits and prevent repeated clicks from submitting the same pending action twice.

Repository: `Sanokei/anascummis`. Branch: `codex/first-use-recovery-20261029`.

| Reference | Exact commit/tree |
| --- | --- |
| Base checkpoint, preserved | `5dd2008e6a9ff1072dc2e6ea28de09e76b2b70f8` |
| Tested source | `a4b80165fa657bfd364932f5233ff5a8bfaeee57` |
| Tested source tree | `b91ddeed64b8116c59411cf996ae0326a3a4f2c7` |
| Before-capture source | `3a9d642c1e6d8ffc52b4226f040346e27ebce5e0` |
| Unchanged remote main | `df70f5ccdb9c3474f04d3f83ad7f60a8f7ecf917` |

This review pack is committed after the tested source; application code is identical. The accompanying chat records the pack commit for pinned retrieval. [source.json](source.json) lists every changed source path. [manifest.json](manifest.json) lists the pack files, sizes and SHA-256 hashes.

## Desktop and phone before/after

These are actual ordinary production-server captures with `model.ready=false`; the landing, failure, setup and request-edit views have no provider, voice or API response mocks. Desktop is 1440×1000; narrow is 360×800.

| View | Desktop | Narrow |
| --- | --- | --- |
| Before: shortcut-only typing, misleading first-use promise | [PNG](screenshots/before-desktop.png) | [PNG](screenshots/before-narrow.png) |
| After: labelled typing and honest readiness/recovery | [PNG](screenshots/after-desktop.png) | [PNG](screenshots/after-narrow.png) |
| Exact saved request reopened for editing | [PNG](screenshots/recovered-request-desktop.png) | [PNG](screenshots/recovered-request-narrow.png) |

Additional evidence: [failed Work before](screenshots/before-work-failure-narrow.png), [failed Work after](screenshots/after-work-failure-narrow.png), [existing setup dialog](screenshots/setup-narrow.png), and [focused composer at 360×420](screenshots/short-viewport-composer.png). The short viewport tests reduced screen space and touch focus in Chromium; it is not a physical phone keyboard capture.

The [unconfirmed-delivery view](screenshots/unconfirmed-delivery-narrow.png) deliberately drops browser delivery after a real POST is accepted. The [newer Goal draft](screenshots/newer-goal-draft-desktop.png) and [newer Software draft](screenshots/newer-software-draft-narrow.png) deliberately hold response delivery while real APIs save work. Those transport controls are fixtures, not provider mocks. [Failure after a real write](screenshots/partial-write-failure-narrow.png) and [explicit retry output](screenshots/explicit-retry-output-desktop.png) use scripted loopback inference with actual host mutations.

## What was tested

**192 tests passed, 0 failed; 1,105 assertions across 18 files.** Both TypeScript targets and the Next.js 16.4.3 production build passed. See [test output](receipts/test-output.txt), [root TypeScript](receipts/root-typecheck.txt), [studio TypeScript](receipts/studio-typecheck.txt) and [production build](receipts/production-build.txt).

The fresh lifecycle checks use isolated data; the original accepted parent is never used as a mutable workspace.

| Check | Actual measured behavior | Receipt |
| --- | --- | --- |
| Normal unavailable first use | Fresh touch user opens typing without Double-Space; setup/recheck is usable; a real multiline request becomes a saved failed Work record; reload/return/edit preserves the full request. Explicit retry has a distinct ID and the original project. Unrelated project revision remains 0; old record/activity stays identical. All three work windows are reachable; typed actions issue zero speech-stream POSTs. | [Native recovery](receipts/native-recovery.json), [result](receipts/native-result.txt) |
| Lost acknowledgement and late failure | A real accepted POST has response delivery aborted. Exactly one row/POST remains and the UI says acceptance is unconfirmed. A held real reply fails after newer typing; the newer draft and previous submitted snapshot both survive. No implicit replay. | [Native recovery](receipts/native-recovery.json), [driver](qa/after-native.mjs) |
| Original PDF context | Real PDF imports, two project/PDF contexts and real failed Work records. Editing restores the original pair before Send; original PDFs and history remain unchanged. One controlled metadata 404 proves a missing original PDF cannot partially switch context. | [PDF context](receipts/pdf-context.json), [result](receipts/pdf-context-result.txt) |
| Pending Goal/Software forms | Real create/resume/revise endpoints accept requests while response delivery is held. Newer drafts remain visible; one POST occurs per pending action. A list poll before acceptance delivery does not duplicate the build card. Parent metadata and ZIP stay identical. | [Pending submissions](receipts/pending-submissions.json), [result](receipts/pending-result.txt) |
| Failure after work starts | Scripted provider makes one real website write, then returns 503. Revision 1 and failed Work remain; readiness refreshes to unavailable. Edit performs no replay. A separate explicit request creates a new ID, verified revision 2 and visible output in the original website. | [Partial write recovery](receipts/partial-write-recovery.json), [result](receipts/partial-result.txt) |
| Planning, handoff, review, interrupted restart | Scripted planner assigns website then dependent analysis. Real host write/evidence is accepted before SIGKILL during analysis. Goals continuation completes analysis, independent acceptance and coverage review. Project stays revision 1; accepted write attempts stay 1, interrupted analysis attempts become 2. Stop prevents late completion of a separate goal. Speech is simulated in this regression only. | [Goal restart](receipts/goal-restart.json), [result](receipts/goal-regression-result.txt) |
| Child build/restart/acceptance | Scripted model plans a distinct UI-created child, then its planning checkpoint is interrupted and resumed. Actual install, TypeScript, tests, production browser heading/counter, ZIP rebuild and downloads pass. Stale downloads are unavailable before acceptance; accepted parent is unchanged. | [Revision restart](receipts/revision-restart.json), [result](receipts/revision-regression-result.txt) |

The focused [recovery](qa/recovery-ui-driver.mjs) and [pending-form](qa/pending-forms-driver.mjs) component fixtures supplement these actual API lifecycles with controlled rejection, stale polling and conflicting-draft cases. Their response mocks are explicit in the adjacent fixture files.

## Scope and implementation

The existing orb composer now has a visible labelled entry point, exact multiline text, explicit Send and Ctrl/Command+Enter. Local readiness reuses `/api/status` and observed voice initialization. Typed window commands and acceptance acknowledgements do not depend on TTS. **Check again** checks readiness; it does not retry a user task or download a model.

Terminal Work that needs attention exposes **Edit saved request**. The full text and original context are staged together, with race guards. A conflicting unsent draft is kept and opened; missing context blocks replacement. Research defaults off and saved private details are not restored. Editing creates no task. Only explicit Send creates a reviewed new run; Work has no fabricated resume checkpoint. Goals/Software retain their existing continuation controls.

Local connection refusal/503 now gives an actionable setup/start error. Cancellation, timeouts, invalid input and other HTTP failures retain their semantics. There is no automatic model retry, prompt redirect, fallback provider or health probe per decision. Goal/Software forms use immutable snapshots and immediate pending guards; late results clear only an unchanged submitted draft and cannot hide newer text.

Primary-source research informed the ambiguous-acceptance behavior: WHATWG Fetch/DOM, RFC 9110 §9.2.2 and React controlled-input/effect documentation. See the original pre-implementation [research memo](research/findings.md) and [retrieval manifest](research/primary-sources.json). The manifest preserves the working archive paths and exact fetched hashes; full standards text is not duplicated here. [sources.json](research/sources.json) records the blocked RFC Editor request and the successful official HTTPWG sources. A lost POST response is not proof the server did nothing, and abort does not roll back accepted work. The UI therefore preserves text and directs inspection instead of replaying automatically.

## Preservation, access and limits

The original accepted parent metadata/source/test/package/lock/ZIP and prior review manifest were checked unchanged. The patched accepted parent also survived both pending-revision and full rebuilt-child checks. See [preservation](receipts/preservation.json). The [saved environment draft](receipts/environment-draft.json) is still revision 5 with identical install/start instructions; no draft update, model provision, secret/service creation, merge, deployment or environment publication occurred in this increment. The earlier checkpoint branch and its review pack are preserved.

The ordinary server was restored and its page, status, Goals, Work and Software GETs returned 200; [status](receipts/normal-server.json) still reports `model.ready=false`. Native Qwen model access and voice initialization remain unavailable. A normal verified-TLS request to Hugging Face still returns the proxy's HTTP 403; see [egress receipt](receipts/model-egress.json). Nothing bypasses that restriction. Scripted inference validates host orchestration/recovery and real output checks; it does not prove native inference or speech readiness.

Pending guards are client-side, not server idempotency. After an unconfirmed acknowledgement, inspecting saved work before an explicit retry is still necessary. Saved accepted Work requests survive reload; an unaccepted page-only draft/notice is not promised to survive reload. Native microphone and spoken-reply behavior, physical-device keyboard behavior and native-model answer quality remain unverified.

GitHub REST/GraphQL access from this shell returned Forbidden, while the existing authenticated Git route supports scoped branch pushes and readback. The prior source-pinned pack was independently retrieved through the connected GitHub tools. This pack uses the same normal private-repository route; it needs no `/workspace/.cloud-env` access. No externally accessible running application preview was issued: the current toolset has no port-publishing facility, and loopback addresses are not shareable previews. Use these source-pinned PNGs for visual review.

## Repeating validation

From `apps/studio`: `bun run test`, `bun run typecheck`, and `bun node_modules/next/dist/bin/next build --webpack`. From the repository root: `bun run typecheck`.

The [QA snapshots](qa) preserve the exact environment-specific helpers, including isolated data directories and startup ownership checks. They require the prepared toolchain, Chromium and a free port 3211, and must not run against user projects. The ordinary server must be stopped before these fixtures own that port and restored afterward. These snapshots are review evidence, not a portable installer or environment draft.
