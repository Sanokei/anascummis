# Local conversation and iterative creation

The orb keeps its original canvas geometry and animation. Holographic light is a restrained overlay. All visual results use floating FlexLayout panels; see SURFACES.md.

## Routing

Plain conversation streams one short Qwen response. Current-news questions go directly to headline retrieval, without a planning model call. Website, PDF, scene, commerce, workspace, research and video requests use bounded specialist harnesses. Background jobs have separate cancellation and evidence; foreground conversation preempts a background model decision. One resident model serves the roles sequentially, avoiding multiple weight copies on consumer CPUs. Project writes serialize and inspect the latest revision.

The context is bounded at 2,048 tokens, not absent. Larger evidence is paginated and passed by task IDs. Shared limits cover model calls, tool actions and delegation. A tool result and host verification establish completion; a model assertion does not.

## Creation loop

After a successful creative website edit, a critic reviews the actual structured site against the request. It can propose one supported revision, dispatch the website harness, and inspect the result again. At most two revision passes and three reviews run within the existing shared budget. Unsatisfied or interrupted reviews remain unfinished. This checks content and structure; it does not establish screenshot quality. Broader candidate search and a trained evaluator require separate evaluation before deployment.

## Voice pipeline

An AudioWorklet sends 16 kHz PCM continuously. Whisper recognition starts speculatively during a short pause, and its result is reused only if the final speech revision matches. Generation streams into short speech chunks; the next chunk is synthesized while the previous one plays. Native Pocket TTS and LavaSR stay resident and stream enhanced PCM into playback. Browser Whisper and Kokoro use separate resident workers. Speech interruption uses sustained microphone energy plus browser echo cancellation; speaker playback and different microphones still need practical testing.

The DOM exposes data-latency and emits an anascummis-timing event at first playback. This distinguishes first text from first audio. Cold downloads, CPU speed, speech recognition and synthesis all affect response time. Offline inference requires weights to have been downloaded first; current news and public image retrieval require connectivity.

## Research informing the implementation

- [Sakana Fugu](https://sakana.ai/fugu-beta/) uses a small learned coordinator to adaptively assemble and coordinate frontier model agents. It can recursively revise coordination. Its API and frontier pool are not an offline CPU runtime. This implementation borrows scoped coordination and corrective review, not Fugu weights or its learned policy.
- [Claude Opus 5.5](https://www.anthropic.com/claude-opus-5-5) provides a reference for sustained agent work and verification. Its public announcement does not disclose an internal router that can be reproduced here. No Opus API is used.
- [NanoJev](https://github.com/jereiard/nanojev) demonstrates batched decision heads instead of autoregressive tool-choice text. Its released game checkpoints and CUDA server are not a trained CPU tool router. Integrating that approach requires tool-routing training data, confidence/abstention calibration and held-out CPU benchmarks. It is not currently installed in this app.
- [OpenAI Realtime](https://developers.openai.com/api/docs/guides/realtime-conversations) and [xAI speech-to-speech](https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech) document streaming sessions and interruptions. The app applies those interaction patterns to its local ASR/LLM/TTS pipeline; it does not claim access to the internal ChatGPT dots or Grok interface implementation.

Small-model orchestration improves grounding and recoverability, but repeated calls do not guarantee frontier-model knowledge or creativity. Measured output quality and latency must govern further routing decisions.
The local voice now streams Pocket TTS audio through LavaSR in bounded chunks, retaining resident models on normal interruption. The public browser uses Kokoro 82M q8. Voice attribution is in licenses/VOICE.md. Initial measured enhanced chunks took 1.35–1.68 seconds on a Ryzen 5 5500U while a production build was also running; this excludes recognition and language generation and is not a full conversational latency result.
