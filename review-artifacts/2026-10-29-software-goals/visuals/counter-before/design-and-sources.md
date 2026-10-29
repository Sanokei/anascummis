# Counter UX baseline and bounded plan

Fresh baseline captures use a copied, unmodified accepted standalone bundle from task `4e210710-16fe-43fd-82a4-f91dab2f5d41`, paired with its SHA-256-checked saved source ZIP. The old app has a correct literal heading and numerical behavior, but no visible Count label and 21px-high controls at both 1440×1000 and 360×800. Original artifact hashes remain unchanged in receipt.json.

The change is limited to the trusted numeric screen compiler. The request parser, schema, grounding, initial value, increment delta, optional reset, reload reset, and local-only behavior remain as before. No broad app generation claim follows from this counter recipe.

Planned rendering: a readable single-column counter with the exact requested H1; a visible, associated output label; a prominent number; 52px-high native Increment/Reset controls; persistent keyboard focus outlines; and a visible polite status message after each action. A short reload note explains the existing lifetime of the value. All fonts/assets remain local. Phone controls stack without horizontal overflow; long headings/labels and large/negative values wrap within the viewport.

The output keeps its semantic output role and accessible name. Its own live announcements are off; one separate polite/atomic status region carries the completed action and current number to avoid duplicate live announcements. Repeated same-value actions replace the status text node so a reset-at-zero still produces a status mutation without moving focus.

Primary sources fetched 2026-10-29 and saved as HTML plus extracted text in research/:

- W3C WCAG2.2 Understanding Target Size (Enhanced), https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html : custom pointer targets at least44×44 CSS pixels; larger targets help touch operation. This is a chosen design target, not a whole-page conformance claim.
- W3C Understanding Focus Visible, https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html : the keyboard focus indicator should be visible and not time limited.
- W3C Understanding Status Messages, https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html : announce important content changes through assistive technology without moving focus or unnecessarily interrupting work.
- W3C Understanding Reflow, https://www.w3.org/WAI/WCAG22/Understanding/reflow.html : preserve information/functionality without scrolling in two dimensions at320 CSS pixels. The focused fixture will exercise320 in addition to the requested360.
- WHATWG HTML output element, https://html.spec.whatwg.org/multipage/form-elements.html#the-output-element : output represents a result of a calculation or user action and is labelable.

Validation boundary: focused actual compiler→React→Chromium checks for exact heading/label,0→1→2→Reset0, keyboard Enter/Space/Tab, visible focus, per-action live status, repeated reset, nonzero/negative/fractional initial+delta, optional-reset absence, hostile strings remaining literal data, reload resetting, no storage/network side effects, desktop/360/320 bounds. This fixture transpiles React for testing; it does not run a Next application build or infer behavior from a snapshot. The separate E2E owner will create a fresh native counter task and independently exercise the produced bundle and actual downloaded source ZIP with matching installed dependencies.
