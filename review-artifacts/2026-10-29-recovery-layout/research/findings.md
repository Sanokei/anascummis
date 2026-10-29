# Recovery layout: viewport, scrolling and layers

Research date: 2026-10-29. This increment changes presentation/focus only; task submission, request snapshots and original-context staging retain their existing logic.

The normal-server before captures reproduce transparent spaces between independently raised composer, helper/context and notice sections, exposing the open Work window. At 360×420, the textarea/Send can fit while context and delivery guidance are below the viewport.

Primary sources:

- The official [Chrome viewport article source](https://raw.githubusercontent.com/GoogleChrome/developer.chrome.com/main/site/en/blog/viewport-resize-behavior/index.md) explains that Chrome Android's default since108 resizes the visual viewport for an on-screen keyboard, without resizing the layout viewport. Viewport-relative CSS units can remain unchanged, and fixed controls can be obscured. The rendered developer.chrome.com URL returned proxy HTTP403; the official source was retrieved normally over verified TLS.
- [CSSOM View](https://raw.githubusercontent.com/w3c/csswg-drafts/main/cssom-view-1/Overview.bs), VisualViewport interface: height/width are CSS pixels; offsetTop/offsetLeft locate the visual viewport within the layout viewport; resize/scroll events report changes. Observe those bounds rather than infer keyboard state from user-agent strings or issue a new permission request.
- [CSS Values4](https://raw.githubusercontent.com/w3c/csswg-drafts/main/css-values-4/Overview.bs), viewport-percentage lengths: some UI intentionally overlays content and does not shift layout or change viewport units; on-screen keyboards typically fit that category. Dynamic viewport units alone do not establish keyboard avoidance.

The bounded panel therefore uses one opaque stacking surface; fixed header/Close and footer/Inspect/Send; and one overflow-auto body owning the textarea, hint, context and delivery notice. Textarea content itself retains native text scrolling. A scoped VisualViewport observer updates height/width and bottom/right offsets, with CSS viewport fallbacks. Cleanup removes observers on Close. The textarea uses16px type to avoid an unnecessary mobile zoom trigger. No browser keyboard permissions, provider setup, replay or task cancellation is introduced by panel controls.

Acceptance checks distinguish actual ordinary-server work and touch/keyboard interactions from deliberately controlled browser delivery. Reduced-height Chromium and VisualViewport geometry controls supplement layout checks; they do not prove physical-device keyboard behavior. Source URLs, retrieval outcomes and exact hashes are in sources.json.
