---
name: design-artwork
description: Make a drawing or a 3D scene by writing source for it, then have every acceptance criterion checked. Use when asked to make a picture, a diagram, an icon, a chart, an illustration, or a 3D object or model.
license: MIT
invocation: automatic
allowed-tools: workspace.write, workspace.read
dependencies: design.open, design.submit, design.read, design.close
---

# Making a picture

You are not generating an image. You are writing a small program that draws one,
and the program is the artifact. That distinction is the whole method: a program
can be measured, so most of what you claim about the result can be checked
against arithmetic instead of being asserted.

## Procedure

1. **Write the acceptance criteria before the source.** `design_open` starts a
   lab with a title, a surface and the criteria the work will be judged against.
   Criteria written after the fact describe what you happened to draw, which is
   not a specification.
2. **Read the vocabulary you were given back.** `design_open` returns what can be
   settled on that surface and, separately, what no check can settle. Aim the
   criteria at the first list.
3. **Write the source and submit it** with `design_submit`. This parses the
   source, measures it, renders it, and settles what it can.
4. **Read the verdicts literally.** Every criterion comes back with a `basis`:
   - `deterministic` — a check settled it against a measurement. `evidence`
     names the numbers. This is the only kind of `met` that means anything.
   - `opinion-only` — a vision model looked at the render and answered. It may
     be right; nothing checked it. Do not report it as verified.
   - `unverifiable` — nobody could settle it. This is not a pass.
   A criterion that came back `not-met` names the number that failed. Fix that
   number, not the criterion.
5. **Revise within the round budget**, which `design_open` states. A parse
   failure does not consume a round; a successful submission does.
6. **Close the lab** with `design_close` and a summary that says what was
   settled and what is still unresolved. If a criterion is still `not-met` or
   `unverifiable` at the end, say so. The honest summary is the deliverable.

## Writing criteria that can be settled

Checkable: counts, named things, positions relative to each other, containment,
nesting, palette size, whether anything was drawn, whether the drawing fits.

Not checkable, ever: whether it looks good, whether it is balanced, whether a
colour is appropriate, whether a shape resembles what it depicts. Write those if
you need them, knowing you will get an opinion back rather than a result, and
say which you got.

Write them the way the vocabulary words them. `design_open` returns the exact
nouns and relation words for your surface, and a criterion using a word from the
other surface comes back as a **refusal** explaining the mismatch rather than as
a check that quietly fails.

## The two surfaces

**`vector`** — an SVG drawing. Name every element you want a criterion to be
able to talk about: a criterion can only refer to something with an `id`, so an
unnamed element is invisible to every check. Name the parts of the picture, not
the tags: `id="horizon"`, not `id="line1"`.

Rendering a drawing needs a browser. When none is configured, the source is
still fully checked and only the pixel criteria come back `unverifiable`; the
submission says so. That is not a failure of your drawing.

**`scene`** — a 3D assembly, compiled to a mesh and exported as a GLB. A scene
program is a list of `part` declarations, each with a `kind`, a `size` and an
`at` that is its **centre in its parent's space**, plus optional `material` and
`joint` lines. Nest parts with `parent=` to build an assembly. The scene renders
itself inside the Worker, so a 3D lab's pixel checks always run.

```
scene "table-lamp" unit=m
material brass color=#b08d57 metal=0.8 rough=0.3 opacity=1
part lamp  kind=group
part base  kind=cylinder size=0.12,0.02,0.12 at=0,0.01,0  parent=lamp mat=brass
part post  kind=cylinder size=0.02,0.45,0.02 at=0,0.24,0  parent=base mat=brass
part shade kind=cone     size=0.18,0.16,0.18 at=0,0.56,0  parent=post mat=brass
joint shade revolute axis=1,0,0 range=-25,25
```

Criteria about a scene refer to part names — `the shade is above the post` — and
the vertical convention is a scene's, where y grows upward. The harness knows
the two surfaces disagree about which way is up and reads each one correctly,
but you should still expect "above" to mean what it looks like it means.

## Boundaries

- **A check's verdict is not your opinion, and your opinion is not a check.**
  When the check and a model disagree, the check stands and the disagreement is
  recorded. Do not overrule a measurement by re-describing the picture.
- **Never report an `opinion-only` or `unverifiable` criterion as met.** If a
  criterion could not be settled, say that plainly; that report is more useful
  than a confident claim, and the specification treats it as the required one.
- **Do not claim the picture looks right because the checks passed.** Checks
  settle counts and positions. Whether it is any good is not something this
  harness can tell you, and pretending otherwise is the failure it was built to
  avoid.
- **A round you submit is shown.** When the result carries a `windowId`, the
  drawing or the scene's rendered views are on screen beside the conversation,
  and so is the reason when nothing could be rendered. A `windowRefused` instead
  means it was not shown; say the round was recorded rather than shown. Do not
  narrate what is already visible — spend the words on what the verdicts settled
  and what they did not.
- The GLB is exported to the session's own storage and fetched through
  `/api/design/{labId}/renders/{revisionId}/mesh.glb`. Nothing renders one in
  the interface yet; say so rather than describing a viewer that is not there.
