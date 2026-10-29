# First-use typing and request recovery

Base checkpoint: `5dd2008e6a9ff1072dc2e6ea28de09e76b2b70f8`, with tested source `3a9d642c1e6d8ffc52b4226f040346e27ebce5e0`, on the immutable `codex/long-horizon-checkpoint-20261029` branch. This increment uses `codex/first-use-recovery-20261029`; it does not change `main`, accepted parent artifacts or the saved environment setup draft.

## Observed barriers

The supervisor independently opened the pinned desktop/narrow images through GitHub. On a phone, the normal first-use view offers Touch the orb and Double-Space but no visible action to reveal typing before a keyboard exists. It also says first use downloads speech/model files while the ordinary server actually reports `model.ready=false`.

The additional ordinary-server audit uses isolated data and no model, voice or API mocks. A real website-edit request becomes a saved failed Work record with “Unable to connect. Is the computer able to access the url?” and only **Open website**. Its full text is saved, but the composer is cleared and the Work card has no edit/retry control. Goals and Software already preserve their records with **Continue remaining work** and **Resume checkpoint**; those controls should be reused. The existing Download dialog already contains setup/start commands, so do not add a competing setup dashboard.

Primary research covers WHATWG Fetch/DOM, RFC9110 idempotency and React controlled-input/effect behavior. A response/stream failure does not prove that a POST was not accepted. Cancellation does not roll back accepted writes. A speech failure after a real task ID is returned is not task failure. No automatic POST replay or fabricated Work checkpoint is justified. The complete source provenance and findings will be copied into this review pack.

## Coherent first increment

- Expose the existing composer with a small labelled **Type a message** tap/keyboard action. Preserve the orb and Double-Space; no new navigation/history surface.
- Reuse `/api/status` for AI reachability and actual voice initialization/failure observations for voice status. Distinguish unknown/checking/unavailable from confirmed initialization. Never infer working voice from AI health, imply that blocked downloads succeeded, or provision a model/service/secret. Offer a manual readiness recheck and the existing setup dialog.
- Typed window commands and saved-task acknowledgements must remain usable without TTS. Typed delivery failures must not revoke a known accepted task, cancel background work or cause an implicit retry.
- Keep failed/unconfirmed typed text recoverable in the existing composer. Preserve any newer unsent text and avoid late response/error overwrites. If acknowledgement is ambiguous, instruct the user to inspect saved work before explicitly submitting another attempt.
- Add **Edit saved request** to terminal Work that needs attention. Restore the exact saved request and original project/optional PDF context before explicit Send. This prepares a reviewed **new** run, not a same-record resume. Preserve the old record/outcome/activity and any already applied changes. Missing context or a conflicting unsent draft blocks replacement with a clear explanation.
- Convert actual local-model transport failures/503 into an actionable setup/start message while preserving cancellation, scheduler/preemption, context/schema failures and other HTTP semantics. No extra health request per model decision or automatic task replay.

## Acceptance evidence

1. On a normal production server with actual native `model.ready=false`, a fresh360px user can tap Type, compose, and open Goals/Work/Software without knowing Double-Space. Readiness and setup/recheck actions are readable; voice remains honestly unavailable/unverified.
2. Enter a real request, inspect its real failed outcome, recover/edit it without retyping, and submit once as a distinct real attempt. Old request/history and unrelated projects remain unchanged. No automatic task-creation POST occurs from opening, editing, checking setup or reloading.
3. Repeat with a different current project/PDF and a newer unsent draft. Restore the saved target deliberately; do not send to the wrong context or overwrite newer text. A missing target remains a visible blocker.
4. With a clearly labelled scripted inference fixture, perform a real website write, then fail the provider. The saved change and terminal Work remain visible. Recovery does not replay it; only a separate explicit edited submission produces a new ID and new host change. This tests host recovery, not native Qwen quality.
5. Cover pre-acceptance failure, late errors after newer typing, speech unavailable after known acceptance, manual Stop, browser reload and return to the correct work window. Keep Goals/Software checkpoint controls intact.
6. Run appropriate tests, both TypeScript targets, production build and real Chromium desktop/narrow captures. Share the before/after pack and exact source/artifact commits through the scoped Git branch, not inaccessible cloud-only links. Verify parent hashes and unchanged setup draft.

## Next observed gap

The source audit also found Goal/Software submission races: late success can clear newer form edits, and Software creation has no pending guard against duplicate clicks. After the first path passes, address that bounded pending-submission behavior with snapshot-aware clearing and an immediate in-flight guard. Delayed-response and failure tests must preserve newer input and issue one POST per explicit pending action. This does not claim server-side idempotency after a lost acknowledgement; that ambiguity must remain explicit until an actual reconciliation protocol exists.
