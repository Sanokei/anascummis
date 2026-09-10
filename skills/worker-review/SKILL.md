---
name: worker-review
description: Review Cloudflare Workers code against the runtime's actual constraints. Use when the user shares a Worker, a wrangler config, or asks why something works locally but not when deployed.
license: MIT
invocation: explicit-only
allowed-tools: net.fetch, workspace.read
dependencies: web.fetch, workspace.read
---

# Worker review

Check code against what `workerd` actually does, and retrieve the current
documentation rather than relying on recall about a platform that changes.

## Procedure

1. Read the code and the wrangler configuration together. A binding that is not
   declared is not available, whatever the code assumes.
2. Check the compatibility date and flags. Behaviour depends on them.
3. Where a platform detail matters, retrieve the current documentation for it
   instead of stating it from memory.
4. Report what is wrong, with the specific reason.

## What to look for

- Node APIs used without `nodejs_compat`, or ones that flag does not provide.
  A dependency can pull one in at module load, which fails before any request.
- Floating promises. Work not passed to `waitUntil` may be killed when the
  response ends.
- Module-scope mutable state treated as durable. An isolate can be recycled at
  any time, and there are many of them.
- KV used where the code needs read-after-write. KV is eventually consistent, so
  a transactional update needs a Durable Object.
- Secrets in code, in a committed config, or in anything sent to a model.

## Boundaries

- Say when something is unverified. Running on Cloudflare does not by itself
  make generated code correct.
- Do not claim to have deployed or tested something unless it actually ran.
