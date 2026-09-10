---
name: artifact-writeup
description: Turn gathered material into a saved document in the session workspace. Use when the user asks for notes, a summary, a brief, or a written record they will want back later.
license: MIT
invocation: automatic
allowed-tools: workspace.read, workspace.write
dependencies: workspace.write, workspace.read
---

# Artifact writeup

Produce a document and save it, then confirm what was actually saved.

## Procedure

1. Work out what the document is for and who reads it. A brief for someone else
   is not the same as notes for yourself.
2. Write it. Lead with the outcome. Keep it short by leaving things out.
3. Save it to the workspace under a descriptive name.
4. Read it back and confirm the saved size and name.

## What to return

Say the artifact name and what is in it. Do not paste the whole document back
into the conversation unless it is short or the user asked for it.

## Boundaries

- Verify the file exists after writing. A completed tool call is not proof the
  goal was met.
- Session workspace artifacts expire with the session. Say so rather than
  implying they are permanent.
- Do not invent detail to fill out a section. A short document that is accurate
  beats a long one that is padded.
