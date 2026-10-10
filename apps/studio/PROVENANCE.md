# Source references

Kinoinstrument was inspected directly through GitHub, without a local clone.

- Repository: https://github.com/Sanokei/kinoinstrument
- Reviewed commit: `8a902de92ef7e60424638de16dcfc5aab45d1cfe`
- `apps/web/src/components/BabylonStage/BabylonStage.tsx`: lazy Babylon loading, lifetime ownership, orbit camera, container resizing and cleanup. Studio uses a smaller WebGL implementation to avoid fetching WebGPU shader tooling during offline use.
- `BILLING_SECURITY.md`: private credentials, server-controlled fulfillment and webhook verification. Studio only links to an existing hosted Stripe Payment Link; it does not claim to implement an order/fulfillment backend.

Stripe's official best-practices skill was read and included for reference:

- https://github.com/stripe/ai/blob/main/providers/claude/plugin/skills/stripe-best-practices/SKILL.md
- Reviewed commit: `9b91884e43839591abd6ee3c70667b2e71d5e687`
- Its security reference was also reviewed. Private/restricted keys and webhook secrets are refused in published website content. Payment fulfillment is explicitly outside the current Payment Link integration.

The PDF Python worker, encrypted vault, public-HTTPS fetch policy, CPU model installer and Python setup were adapted from the user's local PDF File Lover project. This is source reuse; no dependency on that project is required in a fresh installation.

Qwen CPU weights come from `ggml-org/Qwen3-0.6B-GGUF`, and the native runtime from official `ggml-org/llama.cpp` releases. Downloaded revisions and hashes are recorded when provided by the upstream repositories. Browser inference uses `onnx-community/Qwen3-0.6B-ONNX`; this is an ONNX conversion, not an external inference API.

Piper is distributed under GPL-3.0. Review its redistribution obligations before shipping a bundled executable. Voice licenses are separate; speech setup saves the selected voice's model card beside the downloaded files.

NanoJev's published checkpoint is a Qwen3 0.6B backbone trained for game decisions. It is not installed or presented here as a trained website router. Studio uses constrained Qwen decisions and deterministic contracts, with an explicit evaluation boundary.
