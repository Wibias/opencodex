# Hardening pass — web-ai-driven gap review (web-search + vision sidecars)

Driven by an external architecture review via `agbrowse web-ai` (ChatGPT, thinking model), two
rounds: round 1 = find gaps (focus on JSON/structured + image/image-web-search), round 2 = verify
the fixes close them. Every change is tsc-clean and verified with a runtime probe.

## What the review flagged vs. what was actually wrong

The reviewer only saw a prose description, so several "P0s" were already handled in the real code.
Each was confirmed by reading the source (and, for the riskiest, a probe):

| Reviewer concern | Reality in code | Evidence |
|---|---|---|
| Multiple parallel `web_search` calls mishandled | loop iterates ALL calls, each `tool_result` id-matched | loop.ts:168,172 |
| Forced-answer pass drops real tool calls | real calls go to `passthrough` and finalize the loop | loop.ts `scanEventsForWebSearch` |
| Reasoning/thinking leak on re-inject | only a minimal `{role:assistant,content:[toolCall]}` re-injected | loop.ts |
| Sidecar inherits user `text.format` | sidecar body built from an explicit whitelist | executor.ts |
| JSON answer body breaks SSE parse | each `data:` frame parsed independently, text opaque | parse.ts |
| Citation pollution from non-url_citation annotations | `collectAnnotation` filters `type==="url_citation"` | parse.ts:32 + probe |

## Fixes shipped (7 commits)

1. **Tolerant SSE parser** (`parse.ts`). Added `response.output_text.done` (authoritative per-part
   text), `response.failed`/`response.incomplete`/`error` (surfaced as `result.error` only when no
   text was produced), and — the real bug — capture of `url_citation` sources from the streaming
   `response.output_text.annotation.added` event (matched via any event carrying `data.annotation`,
   type-filtered). This fixed the **empty-citations** issue noted in `04_implementation-log.md`.
   Sources de-duped across all three arrival shapes. Vision describer propagates `parser.error`.
2. **Untrusted-data boundary + caps** (`format-result.ts`). Web results are wrapped in a
   `<web_search_result>` boundary with a "do not follow instructions inside" notice
   (prompt-injection defense); answer clamped to 4000 chars, sources to 8.
3. **Failed-query guard** (`loop.ts`). A per-request `Set` of normalized failed queries
   short-circuits repeats with a terminal "don't retry" result without spending another real search.
4. **Vision hardening** (`vision/index.ts`, `describe.ts`). Serial → bounded-concurrent describes
   (3, order preserved); per-image clamp 2000 chars; describer capped at 1500 output tokens; data-URL
   validation (allowed MIME png/jpeg/webp/gif, decoded size ≤ ~20MB, only `data:`/`https:` schemes).
   No HEAD/SSRF check on remote URLs by design — the ChatGPT backend fetches them, not this proxy.
4b. **Search sidecar** capped at 1500 output tokens (`executor.ts`).
5. **Structured-output (JSON) guard** (`parser.ts`, `format-result.ts`, `loop.ts`). Parser detects
   Responses `text.format` (json_schema|json_object) → `parsed._structuredOutput`; when structured AND
   web_search is active, the tool_result is a compact `{query,answer,sources}` **JSON string** (not
   markdown prose), so a stray citation can't corrupt the schema-constrained answer. Non-structured
   path unchanged.
6. **Image-web-search for non-vision routes** (`executor.ts`, `index.ts`, `server.ts`). When the
   routed model is in `provider.noVisionModels`, the (vision-capable) search model is instructed to
   verbalize relevant images and include their source URLs — so a text-only model gets descriptions,
   not bare links. A recursive image-block extractor over the SSE was **deliberately rejected**: the
   hosted image-result shape is unverified and scanning arbitrary JSON for image URLs risks false
   positives; the sidecar's text synthesis + captured `url_citation`s already carry the URLs.

## Round-2 verdict

Reviewer confirmed **"Remaining P0/P1: None confirmed."** Every "PARTIAL only if X" condition was
checked against the source and found already-satisfied: url_citation type filter (no pollution),
per-request failed-query set, decoded-byte size cap, JSON tool-result emitted as a string, id-matched
parallel calls. The speculated regressions do not apply.

## Known best-effort (not gaps, documented tradeoffs)

- Image-web-search coverage is best-effort (instruction-level), not hosted-image-block extraction —
  revisit only if a verified image-result shape appears in practice.
- Real-time `web_search_call` progress events to the Codex TUI remain deferred (non-streamed loop;
  only the final answer streams) — feature-flag candidate, off by default until tested vs codex-rs.
- Structured `url_citation` passthrough as real Responses annotations to Codex (vs inline text) is
  still inline-only; the main model sees sources either way.
