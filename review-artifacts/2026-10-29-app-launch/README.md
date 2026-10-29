# Use a checked app inside Software work

Completed apps previously offered a screenshot, ZIP and manual instructions, with no interactive launch. **Checked trusted counter/task-list pages now have deliberate Start/Stop controls and a usable embedded app.** Saved list items survive explicit restart and compatible child use at the same address; uncertain delivery requires inspection rather than automatic replay.

The final ordinary-product suite passed **4 cases / 44 outcome assertions** at clean source `ade3e434`. Separate read-only navigation passed **2 cases / 8 assertions**. [Final product report](product/report.json), [owner post-validation](product/post-validation.json), [original image review](product/visual-review.json), [exact source paths/trees](source.json), [payload hashes](manifest.json).

## Use it

Open local Studio, type **show software work**, and select a completed checked counter or task list. Click **Start app**, then interact with its page. **Focus app view**, **Back to app controls**, **Check app status** and **Stop running app** remain reachable on desktop, 360×800 and 360×420. Closing Software work leaves its process running; reopening reloads the client page. Saved list items survive, while unsent app input and counter memory do not survive a page reload.

Stop the parent before explicitly starting a compatible child. It reuses the saved address/storage key. An occupied address fails visibly without choosing another port or stopping its owner. Missing dependencies, unsupported code or altered artifacts retain manual ZIP/start instructions. Current normal-server data has **zero builds**: no fixtures were imported or launched there. New users first need a checked build from the [supported requests](https://github.com/Sanokei/anascummis/blob/ade3e43479654e60415876ba681d965c5a8ff296/apps/studio/SOFTWARE.md).

Download actual immutable output: [My Tasks source](product/collection-narrow/accepted-parent-after-launch.zip), [My Week source](product/collection-narrow/accepted-child-after-launch.zip), [counter source](product/counter-narrow/accepted-counter-after-launch.zip). Manual use needs Bun and Node 20.9+: extract a ZIP, run `bun install --frozen-lockfile --ignore-scripts`, `bun run build`, then `bun run start --port 3216` and open its printed address. Existing matching dependencies were reused in this launch increment; no fresh online installation is claimed.

## Original window highlights

Original PNGs retain their captured content/styles. Short views intentionally scroll the app document beneath opaque, reachable controls. These previews are repository artifacts; no public deployment URL is claimed.

| State | Original |
| --- | --- |
| Desktop My Tasks and controls | [1440×1000](product/collection-desktop/04-running-collection-heading-and-controls.png) |
| Readable saved tasks beside Remove | [360×800](product/collection-narrow/05-running-collection-readable-items-and-controls.png) |
| Short collection interaction and toolbar | [360×420](product/collection-narrow/08-short-collection-interaction-and-controls.png) |
| Desktop counter Reset focus/feedback | [1440×1000](product/counter-desktop/04-counter-reset-keyboard-feedback.png) |
| Phone counter Reset focus/feedback | [360×800](product/counter-narrow/04-counter-reset-keyboard-feedback.png) |
| Short counter interaction and toolbar | [360×420](product/counter-narrow/08-short-counter-interaction-and-controls.png) |
| My Week retains existing items | [Compatible child](product/collection-narrow/15-my-week-keeps-existing-items.png) |
| Unconfirmed Start, disabled Reload | [Inspect before retry](product/counter-narrow/02-unconfirmed-start-inspect-before-retry.png) |
| Old-tab session recovery | [Reconnect, disabled Reload](product/collection-narrow/13-sigkill-session-reconnect-keeps-draft.png) |
| Temporary status failure keeps app | [Disabled Reload](product/collection-narrow/10-temporary-status-failure-keeps-app-draft.png) |
| Occupied saved address | [Visible failure/recovery](product/collection-narrow/16-occupied-origin-fails-honestly.png) |
| Current normal Download | [Version/action](normal-current-handoff/narrow-download-current-kit.png) |

## Tested lifecycle and boundaries

Four isolated ordinary production backends use copied, previously native-generated accepted work. Through real product controls they launch the exact accepted client Page in the product-managed worker/iframe, exercise collection duplicates/Add/Remove/reload and counter 0→1→2→Reset 0/keyboard, then verify source/ZIP/model-call identity. No substitute E2E app server, mutation-API seeding, new inference or generated Next build is used.

They cover close/reopen/Studio reload without another Start, awaited Stop, stable-origin explicit restart, SIGTERM/SIGKILL cleanup and interrupted restart without autostart, old-tab 403→explicit GET reconnect, retained drafts, compatible child data and collision refusal. Actual Reload is disabled during uncertain Start, failed status reads and expired sessions until ownership inspection succeeds. Reconnect PNGs show controls/frame, **not the unsent textarea value**; draft preservation belongs to owner assertions/traces. Exited zombie PIDs are identified as Z, not claimed fully reaped. Six hash-only runtime manifests accompany case receipts; [four redacted trace identities](product/trace-inventory.json) identify full traces left local.

Cookies are not port-isolated. The fixed host edge strips credentials before asset handling and rejects response cookies; the [owned-process spike](process/ownership-v3/report.json) separately proves that boundary, real bind/IPC identity, collision rejection and cleanup. [Accepted-Page iframe proof](accepted-page-boundary/report.json), package guards, injected state tests and synthetic component/layout/Reload fixtures retain their own scopes. This is a fixed trusted React runtime for the accepted client Page, **not a packaged Next server or hostile-code sandbox**. Native OS, voice, physical handsets, cross-host deployment, fresh model generation and broad coding quality remain unverified.

## Pins, preserved failures and gates

| Stage | Exact source |
| --- | --- |
| Planned baseline | [f331e280](https://github.com/Sanokei/anascummis/commit/f331e280f1cb4a5a396d0048adc316a1d326d0d3) |
| Initial implementation | [2318ced4](https://github.com/Sanokei/anascummis/commit/2318ced4a96fb019fe271128f40d98718c08b31a) |
| Corrected host layout/history | [32bbce68](https://github.com/Sanokei/anascummis/commit/32bbce6888a1902e4f8dfec0ae4832c84ba02cad) |
| Documentation | [37044f05](https://github.com/Sanokei/anascummis/commit/37044f05d7adb90bc1b1262aa690d44574c56f04) |
| Final Reload ownership guard | [ade3e434](https://github.com/Sanokei/anascummis/commit/ade3e43479654e60415876ba681d965c5a8ff296) |

[Initial 2318 results](before-layout/report.json) retain two collection passes, two strict counter-driver failures and the real 234px squeezed-layout finding. [32bb results](before-reload-guard/report.json) passed their measured lifecycle; they precede the additional Reload-ownership finding and are not relabelled as guarded acceptance. [Static review](reviews/layout-source32bb-static-review.json) retains a nonblocking stale Start-acknowledgment note beneath a clear failed state. [Final guard review](product/visual-review.json) is owner image review, distinct from independent supervisor acceptance.

[32bb implementation gates](gates/layout/layout-implementation-gates.json): 77 tests / 345 assertions, both TypeScript targets and production build. Package/process bytes remain identical through final source; strict worker gates are [separate](process/final-checks-v3.json). [Final client guard gates](gates/final/guard-implementation-gates.json) reran frontend types/build before all four product cases. [Read-only routing](routing/report.json) uses no inference or app launch. [Four genuine resident-Qwen calculations](handoff/native-local-ai-current.json) passed independently; they establish only that bounded local-AI smoke.

## Current source kit and normal-server handoff

[Studio source kit](kit/anascummis-studio-c9c84ba6a1c9844a.zip): **247 payload files / 1,832,950 bytes**, clean source `ade3e434`. [Manifest](kit/manifest.json), [archive/content/source/HTTP verification](handoff/current-kit-receipt.json). Follow its `studio/LOCAL-INSTALL.md`, licenses and lockfile; Studio/model use separate terminals. No fresh clean Studio extraction/start matrix is claimed for this refreshed kit.

```text
Version c9c84ba6a1c9844a5e252cd926ce5cc20c827bfdb91b925b76b5cb39207e0326
ZIP SHA-256 d5ab598227fe7e1674c2751db4704b6589495f7ffab5a0bbd622130f977a7bec
```

[Ten normal-server originals and receipt](normal-current-handoff/receipt.json) verify readiness, empty typing, current download/checksum/instructions and Close with zero mutations/app launches. Studio PID 50046/model PID 18848 remain unchanged. Earlier helper selector/wait/HEAD-metadata failures and partial images are separately qualified in `normal-helper-history/`. [Startup draft revision 13](handoff/startup-config-final-receipt.json) is saved, not published; [instructions](handoff/startup-skill-final.md) and [preservation receipt](handoff/preservation-final-receipt.json) retain prior source kits, accepted work and historical failures.

No databases, pairing/session keys, actual environment files, models, caches, installed dependencies, compiled runtime bundles or full traces are distributed. The source kit intentionally includes its committed `.env.example` template. [Copy origins](copy-origins.json) identify every copied original; [manifest](manifest.json) covers every payload file except itself. The next research→usable-document/brief handoff with interruption remains unproven.
