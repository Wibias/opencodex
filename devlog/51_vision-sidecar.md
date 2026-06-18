# Vision sidecar — give text-only models "eyes"

Companion to the web-search sidecar (devlog/50). Text-only models (grok-composer-2.5-fast, glm-5.2)
can't accept image inputs, but Codex sends them anyway — the injected catalog entries are cloned from
the gpt template, so Codex believes every routed model supports images (and even allows `view_image`).
Fix: describe attached images with a gpt vision model via the ChatGPT passthrough, BEFORE the main
call, and replace each image with text — so the text-only model can reason about it.

## Grounding (codex-rs + opencode-go, as requested)

- **codex-rs** gates images on `model_info.input_modalities` containing `Image`
  (`core/src/tools/handlers/view_image.rs:51` → *"view_image is not allowed because you do not support
  image inputs"*). Our routed catalog entries clone the gpt template → `Image` modality present → Codex
  sends user images + allows `view_image` for text-only models. So the images DO reach the proxy.
- **opencode-go** does the same per-model check (`session/message-v2.ts` `supportsMediaInToolResult`,
  branching on `model.api.npm`), and on oversize media it strips attachments + tells the model
  (`session/compaction.ts:540`). Confirms the pattern: capability is per-model; the host must adapt.

There is no usable "read tool" for text-only models (Codex's `view_image` is gated off for them), so
the sidecar describes images **eagerly** rather than via a tool call.

## Design

`planVisionSidecar` activates when: the routed model is in `provider.noVisionModels`, the request
carries an image, a forward (ChatGPT) provider exists, the sidecar isn't disabled, and the caller
forwarded ChatGPT auth. Then `describeImagesInPlace` replaces every image part with
`[Image content — described by a vision model …]` text, using the message's own text as focus context.
The (now text-only) request continues down the normal path.

- `src/vision/describe.ts` — one image → gpt vision model via forward `/responses` (reuses
  `FORWARD_HEADERS` + `parseSidecarSSE`); `store:false`, `reasoning.effort:"low"`. Never throws.
- `src/vision/index.ts` — `planVisionSidecar` + `describeImagesInPlace`.
- `server.ts handleResponses` — runs it right after the OAuth token swap, before the adapter call.
- `types.ts` — `OcxProviderConfig.noVisionModels`, `OcxConfig.visionSidecar`.
- `oauth/index.ts` — xai preset gains `noVisionModels: [grok-build-0.1, grok-composer-2.5-fast]`;
  `reconcileOAuthProviders` now syncs it. opencode-go `noVisionModels: [glm-5.2]` set in live config.

Defaults (`OcxConfig.visionSidecar`): `enabled` (on when forward+auth exist), `model` (gpt-5.4-mini —
verified vision-capable), `timeoutMs` (45000).

## Verified live

- `opencode-go/glm-5.2` (text-only) + green-circle image → **"Green circle."** ✓
- `xai/grok-composer-2.5-fast` (text-only) + yellow-square image → **"Square, yellow."** ✓
- No token-limit / "does not support images" / sidecar errors; both completed. `tsc` clean.

## Remaining / future

- `noVisionModels` is config-driven (seeded with the named models). A reactive fallback (retry via
  sidecar on a provider "image not supported" 400) would auto-cover unlisted text-only models.
- One sidecar call per image (sequential); could batch/parallelize for multi-image turns.
