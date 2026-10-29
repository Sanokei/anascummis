# Research that answers the saved question

Baseline: `678264ac5fd075921ef7e780f333c00432857423`.

The actual local Qwen run incorrectly completed this UI-submitted goal:

> Where are the Fetch Standard’s tests kept, and where can I see them running against browser engines? Cite the README statements supporting both.

The public primary source is the [WHATWG Fetch README](https://raw.githubusercontent.com/whatwg/fetch/main/README.md). The retained response contains 4,815 characters, text SHA-256 `d484144421db3f758ef98fe5bf13c3dbe1e07a357033af5288298ea0f4f2ceaa`. Its Tests section names the [web-platform-tests repository](https://github.com/web-platform-tests/wpt) and [browser results](https://wpt.fyi/results/fetch). The existing reader retained those facts, but inference received only positions 0–800. Original native failure receipts and screenshots will accompany the final checkpoint.

## One bounded change

Reuse the public reader, SQLite records and existing Goals window. Select relevant passages from retained text locally; persist exact question, selection rationale, offsets and content hashes before inference. Keep the current 1,600-character total evidence budget. Display the reading plan and inspect the exact retained selection. Treat insufficient support as unfinished work. Both answer acceptance and final coverage must see concrete selected text and the answer.

An explicit linked follow-up copies independently verified source snapshots, preserving URL, retrieval time and hashes. It must not fetch again, change the accepted parent or silently submit an unsent draft. Public-research opt-in and existing private-context guards remain required. A revised continuation can append a new immutable reading for its guidance while retaining previous readings and accepted acquisitions.

## Acceptance

1. A genuine local-AI UI journey supplies both requested locations with literal citations from positions beyond 800; check retained source identity and absolute quote offsets independently.
2. Close/reload preserves the question, evidence and completed answer. Inspect actions display the selected saved text on desktop and 360px width.
3. Stage and explicitly submit a linked question asking about quick local iteration and its web-service dependency. Verify a new parent-linked goal, identical source identity/retrieval, no fetch activity, and an unchanged accepted parent.
4. A postal-address question unsupported by the README stays `needs_input`; it must not count as an achieved answer. Preserve its failed/unfinished evidence and a usable explicit continuation.
5. Focused host tests cover selection budgets, separated relevant passages, Unicode offsets, immutable reading reuse/history, source ownership, atomic copies and continuation/restart behavior. Scripted inference tests establish host behavior only. Native browser results establish only the actual bounded questions tested.

No new search key, model download, provider, dashboard, public deployment or main-branch promotion is part of this increment. Voice and physical handset behavior remain unverified.
