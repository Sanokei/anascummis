# Useful software goals, verified from the ordinary UI

**Seven scoped cases passed, zero blocked or failed, with 36 assertions.** Four fresh native software journeys cover task-list creation/revision and counter delivery on desktop and 360px. A separate case recovers a real failed native checkpoint without another model call. Two earlier navigation cases exercise read-only window routing. [Original aggregate verification](native/post-validation.json), [exact source/report pins](source.json), [artifact checksums](manifest.json).

Tested runtime: [`345b82bcc8dee4591bf93c98029624667185a0b9`](https://github.com/Sanokei/anascummis/commit/345b82bcc8dee4591bf93c98029624667185a0b9). Delivery/source-kit head: [`20b7f5c423c4e1fb7e63c8e016605f7ad0ba8411`](https://github.com/Sanokei/anascummis/commit/20b7f5c423c4e1fb7e63c8e016605f7ad0ba8411), which differs only in four documentation files listed in source.json. The production UI was built at `f62573da`; its 88 served-build hashes remain unchanged through both heads. Base: `c599f8182b3e9b94c719110e9248158194e42a73`, branch `codex/task-list-e2e-20261029`. Main and earlier accepted artifacts remain preserved.

## What actually passed

| User goal | Evidence and observed outcome |
| --- | --- |
| Build and use My Tasks, then revise to My Week | [Desktop report](native/task-list-desktop/report.json) and [360px report](native/task-list-narrow/report.json), each `--require-model` exit 0. The unchanged full request through visible typing saves exactly one Software goal. Its full request, actual phase, activity, output and checked download remain inspectable. Add/remove, duplicate-safe individual removal, Tab/Enter and reload persistence pass in both the produced bundle and actual downloaded source project. |
| Keep work while changing the heading | Explicit Revision guidance creates a separate My Week child with its own real checks and source ZIP. Both outputs are independently exercised. A retained browser context and the same owned origin/port are used while replacing the parent server with the child: existing storage bytes/items survive, and further add/remove/reload works. Parent record and redownloaded ZIP stay byte-identical. Different ports/origins do not share storage; no transfer or synchronization is claimed. |
| Resume the actual saved failed build | [Recovery report](native/recovery/report.json), exit 0. Copied native task `74fb284e-c390-428e-8bfe-05ff9767feb2` remains needs_input across open/reload until one visible Resume click. Real validation/package checks then pass, source hashes and revision remain identical, and model decisions remain **1 → 1**. Its exact old failed text receipt is retained in Activity history. Original failed fixture/database hashes remain unchanged. The old screenshot is explicitly not archived as an immutable image. |
| Deliver a usable counter | [Desktop/360px report](native/counter/report.json), `--require-model` exit 0. Exact Bakery Orders heading, visible associated Count label, pointer/touch 0→1→2→Reset 0, Tab/Enter/Space, persistent visible focus, polite atomic feedback including repeated Reset, reload 0 and contained 52px-high controls pass. Actual produced and rebuilt downloaded projects are both tested. |
| Find the right existing work window | [Routing report](native/routing/report.json), desktop/360px exit 0 at clean `f62573da`. Show build progress opens Software. Edit the app heading to Done preserves exact typed text and gives explicit revision instructions without applying it. Open my app gives honest download/start instructions; Show tasks opens Work. No build/revision/chat/goal POST occurs. The unchanged UI makes a repeat of this worker-independent case unnecessary. |

The native Qwen runtime supplies bounded typed specifications and revision decisions; **trusted host compilers generate these supported applications**. Parent task lists use one native decision, revisions use two, and counters use one each. These outcomes do not establish arbitrary model-authored software or general model accuracy. No inference/API answers are substituted in the native journeys. [Plan and acceptance](PLAN.md), [source-backed design](research/findings-and-plan.md), [six official-source retrieval identities](research/sources.json).

## Original, accessible previews

These are original PNGs with no rendered content, style or image edits. Keyboard checks use ordinary focus setup and a status observer. Links are review previews in the private repository; no public deployment URL is claimed.

| Preview | Desktop | 360px |
| --- | --- | --- |
| Actual downloaded My Tasks | [App](native/task-list-desktop/task-list-application-desktop/task-list-parent-downloaded.png) | [App](native/task-list-narrow/task-list-application-narrow/task-list-parent-downloaded.png) |
| Actual downloaded My Week | [Child app](native/task-list-desktop/task-list-application-desktop/task-list-revision-downloaded.png) | [Child app](native/task-list-narrow/task-list-application-narrow/task-list-revision-downloaded.png) |
| Same-origin replacement after retained items and further edits | [My Week](native/task-list-desktop/task-list-application-desktop/task-list-same-origin-replacement.png) | [My Week](native/task-list-narrow/task-list-application-narrow/task-list-same-origin-replacement.png) |
| Exact saved revision request | [Software](native/task-list-desktop/task-list-application-desktop/06-task-list-revision-full-request.png) | [Software](native/task-list-narrow/task-list-application-narrow/06-task-list-revision-full-request.png) |
| Actual checked-ZIP run instructions | [Instructions](native/task-list-desktop/task-list-application-desktop/05-checked-source-run-instructions.png) | [Instructions](native/task-list-narrow/task-list-application-narrow/05-checked-source-run-instructions.png) |
| Counter before | [21px controls](visuals/counter-before/before-desktop.png) | [21px controls](visuals/counter-before/before-narrow.png) |
| Actual downloaded counter now | [App](native/counter/counter-application-desktop/downloaded-counter.png) | [App](native/counter/counter-application-narrow/downloaded-counter.png) |
| Native-produced counter keyboard focus/feedback | [Increment](visuals/counter-native-visual-proof/desktop-keyboard-increment.png), [Reset](visuals/counter-native-visual-proof/desktop-keyboard-reset.png) | [Increment](visuals/counter-native-visual-proof/narrow-keyboard-increment.png), [Reset](visuals/counter-native-visual-proof/narrow-keyboard-reset.png) |
| Retained old validation receipt/error | [Header](visuals/recovery-visual-proof/validation-retry-desktop-header.png), [old error](visuals/recovery-visual-proof/validation-retry-desktop-error.png) | [Header](visuals/recovery-visual-proof/validation-retry-narrow-header.png), [old error](visuals/recovery-visual-proof/validation-retry-narrow-error.png) |
| Ordinary current server readiness | [AI ready, voice unavailable](visuals/normal-current-handoff/desktop-initial-readiness.png) | [AI ready, voice unavailable](visuals/normal-current-handoff/narrow-initial-readiness.png) |
| Ordinary current Download | [Version/action](visuals/normal-current-handoff/desktop-download-current-kit.png), [checksum](visuals/normal-current-handoff/desktop-download-checksum.png) | [Version/action](visuals/normal-current-handoff/narrow-download-current-kit.png), [checksum](visuals/normal-current-handoff/narrow-download-checksum.png) |

The additional counter visual captures use unmodified copies of the real native-produced bundles, with original hashes checked before/after. [Counter visual receipt](visuals/counter-native-visual-proof/receipt.json). Recovery captures read another completed-fixture copy, with no Resume, build or inference; they expose the retained text evidence rather than rerunning recovery. [Recovery visual receipt](visuals/recovery-visual-proof/receipt.json). The [independent final review](validation/independent-final-review.json) separately checks receipts and directly inspects original screenshots; it is not a second execution claim.

## Failures retained, rather than relabelled

1. [Natural entry failure](before/entry-status/report.json): the full request containing “persist remaining tasks” was intercepted as a status query and saved no build. [Original screen](before/entry-status/task-list-application-desktop/outcome.png). The shortcut now consumes a complete status command instead of feature words inside a goal.
2. [Real Qwen worker failure](before/generic-worker/report.json): the same complete goal through the visible Software form stopped at task `93a06b8d-fc82-4ec4-b846-0f57a57e7ccb`, revision 0, after four native decisions: “Inspect a target source file first.” This exposed the unsupported useful-app gap addressed by the disclosed collection compiler.
3. [First implementation failure](before/framework-alert/report.json), clean `f62573da`: the real revision-1 app retained its tasks, but host QA counted Next.js's unrelated shadow route-announcer alert as a storage error. [Original observed app](before/framework-alert/observed-browser.png), [raw browser receipt](before/framework-alert/observed-browser.json). QA now scopes the application's named collection region; an actual app storage error still fails. Explicit Resume archives failed checks and revalidates the same source rather than looping on cached failure.

The [counter baseline receipt](visuals/counter-before/receipt.json) records correct old numerical behavior but no visible Count label and 21px controls. Its original source ZIP/bundle remain unchanged. [Counter design](visuals/counter-before/design-and-sources.md) and [compact official-source index](visuals/counter-before/primary-sources-index.json) explain the chosen 44px minimum target; they do not certify whole-page WCAG conformance. Original third-party document bodies stay local.

## Use the delivered files

Actual checked task-list source: [My Tasks](native/task-list-narrow/task-list-application-narrow/task-list-parent-source.zip) or [My Week](native/task-list-narrow/task-list-application-narrow/task-list-revision-source.zip). [Actual counter source](native/counter/counter-application-narrow/counter-source.zip). Install Bun and Node.js 20.9 or newer, extract a ZIP into a fresh folder, then run inside it:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run build
bun run start --port 3216
```

Keep the terminal running and open its printed loopback address; choose another port if occupied. The independent downloaded-project checks actually used `bun run start --port <ownedPort>` after fresh extraction/typecheck/tests/build, reusing a matching installed dependency tree. A fresh online dependency installation, Windows/macOS executable and one-click Studio launch are not established. The Software card offers manual run instructions; it does not launch an app on the user's computer.

The [current Studio source kit](kit/anascummis-studio-3298a9e9adb589b2.zip) is separate from the generated apps: **237 payload files, 1,648,533 bytes**, source `20b7f5c4`. [Exact manifest](kit/manifest.json), [archive/content/source verification](validation/current-kit-receipt.json), [ordinary browser Download receipt](visuals/normal-current-handoff/receipt.json).

```text
Version 3298a9e9adb589b2d84f2111af36120eee539e6d044ccda1045d3af69edd28b9
ZIP SHA-256 926fc41c9cce47e30ba659e05dbdee1f847ec513f8073bd30607b9a608a2ff16
```

Use its included LOCAL-INSTALL.md, licenses and lockfile to start Studio/model in separate long-lived terminals. The committed `.env.example` is a template containing a loopback URL and optional commented placeholders. Actual environment files, credentials, databases, caches and model weights are excluded. The current kit received archive/hash/source and ordinary HTTP/browser download checks; the prior extraction/install matrix is not claimed to have been repeated for this kit.

## Gates, runtime and limits

[Affected tests](validation/final-affected-tests.log): 63 passed, 367 assertions across 12 files. [Production build](validation/final-build.log) succeeded; [both final TypeScript targets](validation/final-typechecks-receipt.json) exited 0 at delivery head `20b7f5c4`. [Collection compiler/browser fixture](validation/collection-browser-proof.json) and [counter compiler/browser fixture](validation/isolated-counter-fixture.json) provide separately labelled negative/edge controls, not native user-goal substitutes.

[Actual local-AI smoke](validation/native-local-ai-check.json) passed four basic calculations through the real configured native transport. Cached verified weights were reused to restore the missing process; its earlier termination cause remains unknown. [Cached start receipt](validation/model-start.json). The [launcher baseline](validation/model-launcher-baseline.json) exposed swallowed child failure; [fixed launcher receipt](validation/model-launcher-fixed.json) uses isolated scripted child processes to verify exit propagation, not model readiness.

After the user-goal proofs, root [activated current source on the idle normal server](validation/normal-server-activation.json) with unchanged stored API records and the same model process. The ordinary handoff receipt verifies GET/HEAD-only typing/Download checks at 1440×1000 and 360×800, matching actual ZIP bytes and unchanged processes. The loopback address is useful only on that host; it is not a remotely accessible deployment. [Saved startup draft](validation/startup-config-final-receipt.json) is revision 10, still requires publication, and preserves installer/network/secrets/runtime/repository settings. Saving it did not publish or activate an environment snapshot.

[Preservation receipt](validation/preservation-final-receipt.json) confirms the earlier accepted parent, frozen source kit and older tracked review artifacts remain unchanged. Main was not promoted. The source kit includes no network exception or provider secret. Native voice, physical handset keyboards, screen-reader audit, account/cross-device/concurrent-tab sync and broad model accuracy remain outside the verified scope.

For reproduction, use the source-pinned `bun run test:e2e --journey task-list-application --require-model` and `--journey counter-application --require-model` with an already built UI, installed browser/dependencies and the existing native runtime. Recovery replay needs the retained stopped local fixture, which is intentionally not distributed.

This pack contains original reports/results, screenshots and verified source ZIPs. Original HTML reports are unchanged; their full-trace links refer to archives intentionally left local. [Trace inventory](native/trace-inventory.json) identifies 25 archives: 22 final traces covered by post-validation plus three preserved failures. No private-data directory, SQLite, key, model weight, dependency tree, cache or full trace archive is published here. [Copy origins](copy-origins.json) records exact original paths and unchanged bytes. The commit containing this pack changes only this additive review directory and has delivery source `20b7f5c4` as its direct parent.

## Next observed user-result gap

The next acceptance target is explicit launch of an already-checked application in its existing work window. It must show source identity and process state, provide Stop and reopen actions, and preserve browser data and accepted parent versions across a restart without automatic execution. The current release supplies manual run instructions. The [remaining capability roadmap](../../PROJECT-ROADMAP.md) records the broader unfinished goals separately from this verified increment.
