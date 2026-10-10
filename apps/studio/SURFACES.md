# Floating surface rules

The original contract is in `src/shared/types.ts` (SurfaceWindow/SurfacePlan), `src/worker/surfaces/surface.ts`, and `src/client/components/SurfaceLayer.tsx`.

Studio implements that contract with `flexlayout-react` float sublayouts in `components/FloatingPanels.tsx`. Every visual surface goes through this layer, including website/PDF/3D/video/timeline previews and research images/articles/source lists. Do not add fixed-position one-off panels, dashboards or navigation.

- Speech answers; a panel shows persistent information that benefits from seeing, comparing or manipulating it. Open panels for requested previews, attached documents, generated/edited visual artifacts, research source evidence and image/article context. Plain conversation does not need a panel.
- Use stable IDs. Update an existing result in place and preserve its position and size. Different results can coexist. Close only on user dismissal or an explicit close request.
- Panels float, drag, resize, stack, tab and dock through FlexLayout. The conversation beneath stays interactive. Do not open native browser popout windows.
- Show the reason a panel was raised; never steal microphone/input focus for quiet updates. As panel count grows, reduce attention rather than silently discard requested results. Original host bounds are 6 windows per turn and 12 open; refusal must be explicit.
- Render only host-controlled components. Research HTML is data, never executed. Show actual source links, publisher/date, image credit/license and whether imagery is background or a verified event photograph. Images require descriptive alt text.
- Retrieval panels can appear before reasoning and speech finish; image retrieval must not block the spoken answer. An article preview uses sourced text/link, not an arbitrary iframe that publishers may block.
