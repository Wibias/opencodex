# npm release CI + runbook (jawcode-style, Trusted Publishing / OIDC)

## Why
`bun/npm install -g opencodex` install from the **npm registry**, not GitHub — so opencodex must be
published to npm. Modeled on jawcode's release flow, but using **npm Trusted Publishing (OIDC)** so CI
publishes **without a long-lived `NPM_TOKEN` secret** (npm's recommended approach — short-lived OIDC
credentials, provenance generated automatically, nothing to leak).

## What shipped
- `.github/workflows/release.yml` — `workflow_dispatch` (inputs: `version` / `tag` latest|preview /
  `dry-run` default true). Verifies `tag == package.json`, upgrades npm (OIDC needs **npm ≥ 11.5.1**),
  then **tokenless** `npm publish` via OIDC (`id-token: write`) — no `NPM_TOKEN`, no `--provenance`
  (automatic). Post-publish `npm view` smoke.
- `scripts/release.ts` (+ `bun run release` / `release:watch`) — preflight → bump → commit → push →
  dispatch → watch. Not shipped in the tarball.

## One-time setup (owner) — Trusted Publishing
⚠️ A Trusted Publisher can only be configured **after** the package has ≥1 published version. So the
very first publish of the new name is done locally; everything after is tokenless CI.

1. **First publish (local, one-time)** — claims `opencodex`, no token stored anywhere:
   ```bash
   npm login                                # browser auth
   npm version 0.1.0 --no-git-tag-version   # set the first version
   git commit -am "release: v0.1.0" && git push origin main
   npm publish --access public              # prepublishOnly builds the GUI first
   ```
2. **Configure the Trusted Publisher** — npmjs.com → the `opencodex` package → **Settings → Trusted
   Publisher → GitHub Actions**:
   - Organization or user: `lidge-jun`
   - Repository: `opencodex`
   - Workflow filename: `release.yml`
   - Environment name: *(leave blank)*
3. Done — every future release publishes tokenlessly via OIDC. (No `NPM_TOKEN` secret anywhere.)

## Releasing (after setup)
```bash
bun run release 0.2.0            # bump + commit + push + DRY-RUN dispatch + watch
bun run release 0.2.0 --publish  # …and actually publish (tokenless OIDC)
```
Or: Actions → **Release** → Run workflow → version + dist-tag, dry-run on first, then off to publish.

After a real publish, `bun install -g opencodex` / `npm install -g opencodex` (and `ocx update`) work.
opencodex is bun-native, so installers still need **bun** on PATH. Page: https://www.npmjs.com/package/opencodex

## Why not an automation token?
npm now warns that classic automation/granular tokens for CI carry security risk (a leaked write token
publishes arbitrary versions). Trusted Publishing replaces it with per-run OIDC credentials scoped to
this exact repo+workflow — nothing long-lived to store or steal.
