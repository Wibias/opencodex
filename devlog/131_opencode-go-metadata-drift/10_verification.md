# 131.10 — Verification: OpenCode Go Metadata Drift Closure

## Scope

Phase 131 closes the OpenCode Go metadata drift across three repositories:

- GJC upstream clone on `dev`: `/Users/jun/Developer/new/700_projects/jawcode/devlog/_upstream_gjc`
- jawcode on `dev`: `/Users/jun/Developer/new/700_projects/jawcode`
- opencodex on `dev`: `/Users/jun/Developer/new/700_projects/opencodex`

The source-of-truth values are recorded in `00_plan.md`. The generated model contracts still
support only `text` and `image` inputs, so official `video`, `audio`, and `pdf` support remains
recorded as source evidence but is not emitted into generated rows.

## GJC

Modified:

- `/Users/jun/Developer/new/700_projects/jawcode/devlog/_upstream_gjc/packages/ai/src/provider-models/openai-compat.ts`
- `/Users/jun/Developer/new/700_projects/jawcode/devlog/_upstream_gjc/packages/ai/test/issue-887-repro.test.ts`
- `/Users/jun/Developer/new/700_projects/jawcode/devlog/_upstream_gjc/packages/ai/src/model-thinking.ts`
- `/Users/jun/Developer/new/700_projects/jawcode/devlog/_upstream_gjc/packages/ai/src/models.json`

Verification:

- `bun test packages/ai/test/issue-887-repro.test.ts` passed: 10 tests, 0 failures.
- `bun --cwd=packages/ai run generate-models` produced `opencode-go: 20 models`.
- `bun --cwd=packages/ai run check` passed.
- Custom 20-row comparison against generated `opencode-go` rows returned `bad=0`.

GJC needed one extra guard in `model-thinking.ts`: the global `minimax-m3` 1M policy now excludes
`provider === "opencode-go"`, because OpenCode Go's official `minimax-m3` context is 512000.

## jawcode

Modified:

- `/Users/jun/Developer/new/700_projects/jawcode/packages/ai/src/provider-models/openai-compat.ts`
- `/Users/jun/Developer/new/700_projects/jawcode/packages/ai/test/issue-887-repro.test.ts`
- `/Users/jun/Developer/new/700_projects/jawcode/packages/ai/src/models.json`

Verification:

- `bun test packages/ai/test/issue-887-repro.test.ts` passed: 10 tests, 0 failures, 19 assertions.
- `bun --cwd=packages/ai run generate-models` produced `opencode-go: 20 models`.
- `bun --cwd=packages/ai run check` passed.
- Custom 20-row comparison against generated `opencode-go` rows returned `bad=0`.

Commit:

- `80395c9c fix(ai): sync opencode go model metadata`

Existing jawcode dirty files were preserved and not staged:

- `/Users/jun/Developer/new/700_projects/jawcode/AGENTS.md`
- `/Users/jun/Developer/new/700_projects/jawcode/.agents/`
- `/Users/jun/Developer/new/700_projects/jawcode/.claude/`

## opencodex

Modified:

- `/Users/jun/Developer/new/700_projects/opencodex/src/generated/jawcode-model-metadata.ts`
- `/Users/jun/Developer/new/700_projects/opencodex/tests/codex-catalog.test.ts`
- `/Users/jun/Developer/new/700_projects/opencodex/devlog/131_opencode-go-metadata-drift/10_verification.md`

Verification:

- `bun run generate:jawcode-metadata` regenerated from
  `/Users/jun/Developer/new/700_projects/jawcode/packages/ai/src/models.json`.
- `bun test tests/codex-catalog.test.ts` passed: 12 tests, 0 failures, 90 assertions.
- `bun test tests/provider-registry-parity.test.ts` passed: 8 tests, 0 failures, 23 assertions.
- `bun test tests` passed: 64 tests, 0 failures, 230 assertions.
- `bun x tsc --noEmit` passed.
- Generated metadata 20-row comparison for `opencode-go` returned `bad=0`.

The catalog regression test now locks high-risk OpenCode Go rows through the full opencodex path:

- `glm-5.2`: `context_window=1000000`, `auto_compact_token_limit=900000`, `input_modalities=["text"]`
- `qwen3.5-plus`: `context_window=1000000`, `auto_compact_token_limit=900000`, `input_modalities=["text","image"]`
- `kimi-k2.7-code`: `context_window=262144`, `auto_compact_token_limit=235929`, `input_modalities=["text","image"]`
- `minimax-m3`: `context_window=512000`, `auto_compact_token_limit=460800`, `input_modalities=["text","image"]`
- `hy3-preview`: `context_window=256000`, `auto_compact_token_limit=230400`, `input_modalities=["text"]`

## Result

The OpenCode Go metadata drift is closed at source generation, jawcode consumption, and opencodex
catalog export. Codex routed catalog entries now receive corrected context limits and compaction
thresholds for the tracked OpenCode Go models.
