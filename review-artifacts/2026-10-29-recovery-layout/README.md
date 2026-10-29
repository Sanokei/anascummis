# Bounded request recovery — 2026-10-29

The recovered-request and unconfirmed-delivery composer now owns one opaque panel. Close and explicit Send remain visible; the textarea, keyboard hint, original website/PDF and research context, and delivery notice scroll inside that panel. Work remains visible behind it without text showing through the composer. This is the focused correction to the supervisor's narrow-layout findings at the previous checkpoint.

Repository: `Sanokei/anascummis`. Branch: `codex/recovery-layout-20261029`.

| Reference | Exact commit/tree |
| --- | --- |
| Preserved base/source-and-QA checkpoint | `8788f7545c5091dfaf86dc569304f77e80e66019` |
| Tested source | `619844a4fbfbde736389cd7065313766e94b8537` |
| Tested source tree | `4024234d0fa366c715ec636093065653524addda` |
| Before application source | `a4b80165fa657bfd364932f5233ff5a8bfaeee57` |
| Unchanged remote main | `df70f5ccdb9c3474f04d3f83ad7f60a8f7ecf917` |

The artifact commit follows the tested source with identical application files. The accompanying chat records its hash for pinned retrieval. [source.json](source.json) records the source and capture runs; [manifest.json](manifest.json) contains exact file paths, byte counts and SHA-256 hashes. The application changes are confined to [page.tsx](../../apps/studio/app/page.tsx) and [style.css](../../apps/studio/app/style.css), plus the [acceptance plan](PLAN.md). No task/provider/backend/dependency code changed.

## Fresh ordinary-server screenshots

These are original Chromium screenshots from fresh isolated data on the ordinary production server, with actual native `model.ready=false` and voice initialization unavailable. No provider or voice responses are mocked. The unconfirmed state deliberately drops browser acknowledgement after the real server accepts the POST. All captures precede the explicitly controlled viewport-geometry checks.

| State | Before desktop, 1440×1000 | After desktop | Before 360×800 | After 360×800 |
| --- | --- | --- | --- | --- |
| Recovered request | [PNG](screenshots/before-recovered-desktop.png) | [PNG](screenshots/recovered-desktop.png) | [PNG](screenshots/before-recovered-360x800.png) | [PNG](screenshots/recovered-360x800.png) |
| Unconfirmed delivery | [PNG](screenshots/before-unconfirmed-desktop.png) | [PNG](screenshots/unconfirmed-desktop.png) | [PNG](screenshots/before-unconfirmed-360x800.png) | [PNG](screenshots/unconfirmed-360x800.png) |

At **360×420**, the companion views show the intentionally scrolled portions of the same bounded panel; fitting only the textarea is not treated as a recovery-layout pass.

| State | Before | After: field/helper | After: context/notice | After: recovery actions |
| --- | --- | --- | --- | --- |
| Recovered request | [PNG](screenshots/before-recovered-360x420.png) | [PNG](screenshots/recovered-360x420-message.png) | [Original website/research](screenshots/recovered-360x420-context.png) | Close, Inspect and Send stay visible in both views |
| Unconfirmed delivery | [PNG](screenshots/before-unconfirmed-360x420.png) | [PNG](screenshots/unconfirmed-360x420-message.png) | [Delivery warning](screenshots/unconfirmed-360x420-warning.png) | [Edit/Dismiss, with fixed Close/Inspect/Send](screenshots/unconfirmed-360x420-actions.png) |

[Inspect returns to Work](screenshots/inspected-work-360x420.png), with the composer closed and the saved request/notice retained for reopening. At the short height, context and notice contents need scrolling; the header and footer do not. Text clipping at their borders is the owned scroll content, not the underlying Work window.

## Affected checks and actual lifecycle

The final [ordinary-server receipt](receipts/recovery-layout.json) is from `after-mwU09H`; the [PDF receipt](receipts/pdf-context.json) is from `pdf-context-5w4usG`. The before reproduction is saved [unchanged](receipts/before.json), from `before-TuJGY4`. These are separate isolated databases, not edits to a user's accepted project.

| Matrix state | Panel bounds | Scroll body: client/content height | Result |
| --- | --- | --- | --- |
| Recovered, 360×800 | x16, y374.44, 328×413.56; bottom788 | 298/298 | Pass |
| Recovered, 360×420 | x16, y128, 328×280; bottom408 | 164/298 | Pass |
| Unconfirmed, 360×800 | x16, y188, 328×600; bottom788 | 484/537 | Pass |
| Unconfirmed, 360×420 | x16, y128, 328×280; bottom408 | 164/537 | Pass |

Each state checks an opaque white panel, all request parts owned by its scroll body, no Work descendant, no horizontal overflow, and unobscured header/footer hit targets within the viewport. Actual touch focuses the textarea and research control. Enter in the textarea inserts a line. Space toggles research; Enter on that checkbox produces no submission. Tab brings the context and recovery controls into view; leaving the editor by keyboard closes it and preserves the draft. Close/Escape return focus to Type. Inspect closes the editor and focuses Work. Reopening retains exact text and notice. Navigation, scrolling, editing, dismissal and inspection issue zero POSTs.

The same run exercises a real failed multiline Work request, a conflicting newer draft, reload/return, original project restoration and an explicit distinct retry. The old Work record and activity stay identical; the unrelated project stays revision0. A real POST accepted before delivery is lost leaves one row and one explicit POST, with no replay. A held real reply fails after newer typing; the newer draft and kept earlier snapshot both survive. Ctrl+Enter explicitly submits that reply once. Typed actions issue zero speech-stream POSTs; page errors are empty.

Two additional actual accepted/lost-acknowledgement cases verify Inspect reaches and focuses **Goals** and **Software** after their normal polls show the real saved row. Both honestly reach `needs_input` with native inference unavailable; neither is represented as completed work. Each case issues one explicit POST and no automatic replay. The [PDF check](receipts/pdf-context.json) verifies the original website/PDF are restored together, exact saved text and old history survive, imported PDF bytes/revisions stay unchanged, and a controlled original-PDF metadata404 cannot partially switch the selected context.

The [studio TypeScript target](receipts/studio-typecheck.txt) and [Next.js16.4.3 production build](receipts/production-build.txt) passed. [Browser result](receipts/recovery-layout-result.txt) and [PDF result](receipts/pdf-context-result.txt) both completed successfully. The previously recorded192-test suite, root TypeScript and unrelated restart/build lifecycles remain at the preserved base checkpoint; they were not repeated for this presentation/focus correction.

## Browser behavior and implementation

The [primary-source memo](research/findings.md), [source retrieval hashes](research/sources.json) and [official Chrome article source](research/chrome-viewport-source.md) explain why fixed controls need observed visual-viewport bounds. A phone keyboard can shrink the visual viewport without changing layout viewport units. CSSOM View defines visual width/height, offsets and resize/scroll events. The rendered Chrome documentation endpoint returned proxy403; its official GitHub source was fetched normally with verified TLS.

The panel observes VisualViewport resize/scroll while open, uses viewport-unit/inner-size fallbacks, and cleans up listeners on Close. Its middle content has one bounded scroll owner; the textarea retains native text scrolling. Header/footer are opaque and outside that scrolling body. Research defaults off; private details are not restored. A small Message kept badge makes a closed unconfirmed draft discoverable. Escape closes the editor without aborting work, and moving focus to the background UI dismisses the editor instead of covering the focused control.

A [native HTML checkbox probe](research/checkbox-enter.json) established that Enter can implicitly submit its parent form. That default is prevented for the research checkbox; Space retains native toggling. Send and the documented textarea Ctrl/Command+Enter remain explicit submit actions. The existing exact-text snapshot, conflict guards, original project/PDF staging and no-replay logic are retained.

After the normal screenshot matrix, explicitly controlled VisualViewport height/width/offset events check bottom/right placement and a missing-API fallback. Those geometry controls are labelled in the receipt, restore the browser properties afterward, and issue no POSTs. Neither reduced-height screenshots nor those controls establish physical-phone keyboard behavior. Native Qwen quality, microphone capture and spoken replies remain unverified.

## Preservation and review access

[Preservation checks](receipts/preservation.json) confirm the original accepted parent metadata/source/test/package/lock/ZIP and prior review manifest are unchanged, as are the patched accepted parent's source and ZIP hashes. The saved [environment draft](receipts/environment-draft.json) remains revision5 with identical install/start instructions and no update in this increment. The base checkpoint and earlier harness checkpoint branches are preserved. Main was not changed; no PR, deployment, new chat, policy bypass, credentials or provider/service provisioning was performed.

The ordinary server remains running; its page and status/Work/Goals/Software GETs returned200, with [model.ready=false](receipts/normal-server.json). [Hugging Face egress](receipts/model-egress.json) still fails with the proxy's HTTP403 over the ordinary verified-TLS route. The readiness limitations are not hidden by the UI correction.

This normal scoped Git branch is the accessible source/QA checkpoint. Its pinned PNGs and receipts need no `/workspace/.cloud-env` access. No external running application preview is available through the current port-publishing tools; no loopback link is represented as a shareable preview.

The [QA helper snapshots](qa) preserve the environment-specific commands, isolated-data creation and own-server startup checks. They use port3212, leaving the normal server on3211. Source the prepared environment before running them; before mode requires building the preserved base source, and after mode requires building the tested source. They are review helpers, not an installer or a portable environment draft.

## Recorded validation corrections

The first extended helper failure was masked by its screenshot error handler: [ReferenceError: page is not defined](receipts/helper-error.txt). After repairing that handler, [the underlying assertion](receipts/helper-poll-assertion.txt) showed the test checked saved-row text before the normal window poll delivered it. The final helper waits for the actual accepted record. Neither intermediate failure is counted as a pass; the final ordinary-server and PDF runs above passed.

At11:48UTC, after the final validation command returned exit0, a read-only shell request failed with `exec-server transport disconnected`. Retrying that ordinary read succeeded and recovered the completed logs and receipts; no process replacement, new thread or alternative access route was used. See [execution note](receipts/execution-note.json).
