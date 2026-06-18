# Phase 5 — Multi-Provider OAuth Login (Anthropic · xAI · Kimi)

> Goal (jaw goal 111bbc5f): add OAuth login to opencodex for **Anthropic / xAI / Kimi**, in
> both the **GUI (:10100)** and **CLI (`ocx login`)**, by **porting jawcode's TypeScript OAuth**
> (PKCE callback + Kimi device-code), storing tokens under `~/.opencodex` with auto-refresh,
> and authenticating real provider APIs via a new `authMode: "oauth"`. Plus an `ocx service`
> command (launchd/Windows) — tracked separately in `50_phase6_service_command.md`.
>
> **gpt is excluded** — the existing `authMode: "forward"` ChatGPT passthrough stays untouched.
> Google/Perplexity are deferred (blocked upstream).

## Why (plain words)

Right now opencodex can only talk to non-gpt providers with an **API key** you paste into
`~/.opencodex/config.json`. jawcode already solved real **OAuth login** (the "Login with Grok /
Claude / Kimi" browser flow) in TypeScript. We copy that proven flow into opencodex so you can
log in with your account instead of managing keys. The login token is saved in
`~/.opencodex/auth.json` and auto-refreshed before it expires. Because xAI/Kimi speak the
OpenAI-compatible API and Anthropic has its own adapter (both already in opencodex), the **only**
new wiring is: "when a provider is in `oauth` mode, fetch a fresh access token and use it as the
Bearer key." Everything downstream (routing, adapters, streaming) is unchanged.

## Done criteria (user-approved)

1. **xAI first, end-to-end**: `ocx login xai` (or GUI button) → token saved → a real model
   request routed through opencodex to `api.x.ai` succeeds. (Cycle 1)
2. Anthropic + Kimi log in and make a real request the same way. (Cycle 2)
3. `ocx service` registers + starts on macOS launchd (Windows path implemented). (Cycle 3 — separate doc)

## PABCD cycles (3 passes, this is "몇번의 pabcd")

| Cycle | Outcome (user-visible) | Devlog |
|-------|------------------------|--------|
| **1** | **xAI OAuth login works end-to-end** (CLI + minimal GUI) — builds all shared OAuth infra | this doc §Cycle 1 |
| **2** | Anthropic (PKCE callback) + Kimi (device-code) login + richer GUI provider selector | this doc §Cycle 2 |
| **3** | `ocx service install/start/stop/status/uninstall` (launchd + Windows) | `50_phase6_service_command.md` |

Classification: **C4** (credentials/tokens = security boundary) → full PABCD + THOROUGH verification each cycle.

---

## Architecture decision

**Token resolution happens at the request boundary, not inside the (sync) router.**
`routeModel()` stays synchronous and untouched. In `server.ts handleResponses`, after routing,
if `route.provider.authMode === "oauth"` we `await getValidAccessToken(providerName)` (refreshing
if expired) and set it as `route.provider.apiKey`. The existing `openai-chat` adapter then emits
`Authorization: Bearer <token>` with zero changes. Anthropic adapter: same idea (token as key).

**Why xAI uses `openai-chat`:** xAI's API is OpenAI-compatible at `https://api.x.ai/v1`. So the
new `xai` provider entry is `{ adapter: "openai-chat", baseUrl: "https://api.x.ai/v1", authMode: "oauth" }`.

**Storage:** separate `~/.opencodex/auth.json` keyed by provider — kept OUT of `config.json` so the
GUI's key-masking (`/api/config` GET) and config round-trips never touch raw tokens.

---

## Cycle 1 — xAI end-to-end

### NEW files (under `src/oauth/`)

#### `src/oauth/types.ts` (complete)
```ts
/** Minimal OAuth types, ported from jawcode packages/ai/src/utils/oauth/types.ts. */
export type OAuthCredentials = {
  refresh: string;
  access: string;
  expires: number; // epoch ms (already skew-adjusted by the provider flow)
  email?: string;
  accountId?: string;
};

export interface OAuthController {
  onAuth?(info: { url: string; instructions?: string }): void;
  onProgress?(message: string): void;
  onManualCodeInput?(): Promise<string>;
  signal?: AbortSignal;
}

export type LocalTokenImportMode = "off" | "fallback" | "only";
```

#### `src/oauth/pkce.ts` (complete — verbatim port)
```ts
/** PKCE verifier/challenge (S256). Ported verbatim from jawcode oauth/pkce.ts. */
export async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const verifierBytes = new Uint8Array(96);
  crypto.getRandomValues(verifierBytes);
  const verifier = Buffer.from(verifierBytes).toString("base64url");
  const data = new TextEncoder().encode(verifier);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const challenge = Buffer.from(hashBuffer).toString("base64url");
  return { verifier, challenge };
}
```

#### `src/oauth/callback-server.ts` (port of jawcode oauth/callback-server.ts)
Port the `OAuthCallbackFlow` abstract class + `parseCallbackInput` **verbatim**, with TWO changes:
1. Replace `import templateHtml from "./oauth.html" with { type: "text" }` with an inline
   `const SUCCESS_HTML = "<!doctype html><html><body style='font-family:sans-serif;text-align:center;padding:4rem'><h2>✅ Login complete</h2><p>You can close this tab and return to opencodex.</p></body></html>"`
   and an error variant; the handler returns the appropriate one (no `__OAUTH_STATE__` JS injection needed — opencodex's GUI polls `/api/oauth/status`, it doesn't read the callback page).
2. Import types from `./types` (already matches).
Keeps: preferred-port→random fallback, `redirectUri` lock, CSRF state check, manual-input race, 300s timeout. Uses `Bun.serve` (already Bun).

#### `src/oauth/local-token-detect.ts` (VERBATIM port of jawcode's `detectGrokCliToken`)
**[Audit round 1 fix #1]** The grok-cli store is a keyed map, NOT flat fields. Ported exactly from
`jawcode/.../oauth/local-token-detect.ts:13,89-113`:
```ts
/** Detect an existing Grok CLI token (~/.grok/auth.json) for headless import/verify. */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { OAuthCredentials } from "./types";

const XAI_AUTH_KEY_PREFIX = "https://auth.x.ai::";

export function detectGrokCliToken(): OAuthCredentials | null {
  const authPath = join(homedir(), ".grok", "auth.json");
  if (!existsSync(authPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(authPath, "utf8")) as Record<string, Record<string, unknown>>;
    const entry = Object.entries(raw).find(([key]) => key.startsWith(XAI_AUTH_KEY_PREFIX))?.[1];
    if (!entry?.key || !entry?.refresh_token) return null;
    const accessToken = entry.key as string;
    const refreshToken = entry.refresh_token as string;
    const expiresAt = entry.expires_at ? new Date(entry.expires_at as string).getTime() : 0;
    return {
      refresh: refreshToken,
      access: accessToken,
      expires: expiresAt,
      accountId: entry.user_id as string | undefined,
      email: entry.email as string | undefined,
    };
  } catch { return null; }
}
```
Note: access token is under `entry.key` (not `access_token`), expiry is an ISO string under
`expires_at`. This is the e2e shortcut so xAI can be verified **without** a browser when a grok-cli
token already exists.

#### `src/oauth/xai.ts` (port of jawcode oauth/xai.ts)
Port `discoverXaiOAuthEndpoints`, `XaiOAuthFlow`, `loginXai`, `refreshXaiToken` **verbatim**.
Changes: import `OAuthCallbackFlow` from `./callback-server`, `generatePKCE` from `./pkce`, types
from `./types`, `detectGrokCliToken` from `./local-token-detect`. Constants unchanged:
client_id `b1a00492-073a-47ea-816f-4c329264a828`, discovery `https://auth.x.ai/.well-known/openid-configuration`,
callback `127.0.0.1:56121/callback`, scope `openid profile email offline_access grok-cli:access api:access`.

#### `src/oauth/store.ts` (complete)
```ts
/** OAuth token store at ~/.opencodex/auth.json, keyed by provider name. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getConfigDir } from "../config";
import type { OAuthCredentials } from "./types";

const AUTH_PATH = join(getConfigDir(), "auth.json");
type AuthStore = Record<string, OAuthCredentials>;

export function loadAuthStore(): AuthStore {
  if (!existsSync(AUTH_PATH)) return {};
  try { return JSON.parse(readFileSync(AUTH_PATH, "utf-8")) as AuthStore; } catch { return {}; }
}
function persist(store: AuthStore): void {
  const dir = getConfigDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(AUTH_PATH, JSON.stringify(store, null, 2) + "\n", "utf-8");
}
export function getCredential(provider: string): OAuthCredentials | null {
  return loadAuthStore()[provider] ?? null;
}
export function saveCredential(provider: string, cred: OAuthCredentials): void {
  const s = loadAuthStore(); s[provider] = cred; persist(s);
}
export function removeCredential(provider: string): void {
  const s = loadAuthStore(); delete s[provider]; persist(s);
}
```

#### `src/oauth/index.ts` (complete — registry + refresh dispatch + token resolution)
```ts
import type { OAuthController, OAuthCredentials } from "./types";
import type { OcxConfig, OcxProviderConfig } from "../types";
import { loadConfig, resolveEnvValue, saveConfig } from "../config";
import { getCredential, saveCredential } from "./store";
import { loginXai, refreshXaiToken } from "./xai";

const REFRESH_SKEW_MS = 60_000;

interface OAuthProviderDef {
  login(ctrl: OAuthController): Promise<OAuthCredentials>;
  refresh(refreshToken: string, signal?: AbortSignal): Promise<OAuthCredentials>;
  /** provider entry written into config.json on first login. */
  providerConfig: OcxProviderConfig;
  defaultModel: string;
}

export const OAUTH_PROVIDERS: Record<string, OAuthProviderDef> = {
  xai: {
    login: (ctrl) => loginXai(ctrl, { importLocal: "fallback" }),
    refresh: refreshXaiToken,
    providerConfig: {
      adapter: "openai-chat",
      baseUrl: "https://api.x.ai/v1",
      authMode: "oauth",
      models: ["grok-4", "grok-4-fast", "grok-code-fast-1"],
      defaultModel: "grok-4",
    },
    defaultModel: "grok-4",
  },
  // cycle 2: anthropic, kimi
};

export function isOAuthProvider(name: string): boolean {
  return name in OAUTH_PROVIDERS;
}

/** Return a valid access token, refreshing + persisting if expired. Throws if not logged in. */
export async function getValidAccessToken(provider: string): Promise<string> {
  const def = OAUTH_PROVIDERS[provider];
  if (!def) throw new Error(`Unknown OAuth provider: ${provider}`);
  const cred = getCredential(provider);
  if (!cred) throw new Error(`Not logged in to ${provider}. Run: ocx login ${provider}`);
  if (cred.expires > Date.now() + REFRESH_SKEW_MS) return cred.access;
  const fresh = await def.refresh(cred.refresh);
  saveCredential(provider, fresh);
  return fresh.access;
}

// [Audit round 1 fix #2] Shared bearer-token resolver for /models listing — used by BOTH
// server.ts:fetchAllModels and codex-catalog.ts:fetchProviderModels so OAuth providers'
// models are listed. Returns undefined for forward-mode or oauth-not-logged-in (caller skips).
export async function resolveModelsAuthToken(name: string, prov: OcxProviderConfig): Promise<string | undefined> {
  if (prov.authMode === "forward") return undefined;
  if (prov.authMode === "oauth") {
    try { return await getValidAccessToken(name); } catch { return undefined; }
  }
  return resolveEnvValue(prov.apiKey);
}

/** [Audit round 1 fix #3] Add/refresh an OAuth provider's config entry on a config object. */
export function upsertOAuthProvider(config: OcxConfig, provider: string): void {
  const def = OAUTH_PROVIDERS[provider];
  if (!def) return;
  config.providers[provider] = { ...def.providerConfig };
}

/** Run the login flow, persist the credential + upsert the provider entry, return cred. */
export async function runLogin(provider: string, ctrl: OAuthController): Promise<OAuthCredentials> {
  const def = OAUTH_PROVIDERS[provider];
  if (!def) throw new Error(`Unknown OAuth provider: ${provider}`);
  const cred = await def.login(ctrl);
  saveCredential(provider, cred);
  const config = loadConfig();
  upsertOAuthProvider(config, provider);
  saveConfig(config);
  return cred;
}

// [Audit round 1 fix #4] GUI async login: start the flow, return the auth URL EARLY (the flow
// keeps running in the background until the callback server captures the redirect), with a
// concurrency guard and an error surfaced via getLoginStatus().
const loginState = new Map<string, { error?: string; done: boolean }>();

export function getLoginStatus(provider: string): { loggedIn: boolean; email?: string; error?: string } {
  const cred = getCredential(provider);
  const st = loginState.get(provider);
  return { loggedIn: !!cred, email: cred?.email, error: st?.error };
}

export async function startLoginFlow(provider: string): Promise<{ url: string; instructions?: string }> {
  const def = OAUTH_PROVIDERS[provider];
  if (!def) throw new Error(`Unknown OAuth provider: ${provider}`);
  if (loginState.get(provider) && !loginState.get(provider)!.done) {
    throw new Error(`A login for ${provider} is already in progress`);
  }
  loginState.set(provider, { done: false });
  return new Promise((resolve, reject) => {
    let urlResolved = false;
    const ctrl: OAuthController = {
      onAuth: ({ url, instructions }) => { urlResolved = true; resolve({ url, instructions }); },
      onProgress: () => {},
    };
    // Background: runLogin persists cred + upserts provider (live config mutated by caller via loadConfig/saveConfig).
    runLogin(provider, ctrl)
      .then(() => { loginState.set(provider, { done: true }); })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        loginState.set(provider, { done: true, error: msg });
        if (!urlResolved) reject(e);
      });
  });
}
```

#### `src/oauth/login-cli.ts` (complete — CLI entry)
```ts
import * as readline from "node:readline";
import { exec } from "node:child_process";
import { loadConfig, readPid } from "../config";
import { OAUTH_PROVIDERS, runLogin } from "./index";

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open"
    : process.platform === "win32" ? "start \"\"" : "xdg-open";
  exec(`${cmd} "${url}"`, () => {});
}

export async function handleLogin(provider?: string): Promise<void> {
  const name = (provider ?? "").trim().toLowerCase();
  if (!name || !OAUTH_PROVIDERS[name]) {
    console.error(`Usage: ocx login <provider>\n  providers: ${Object.keys(OAUTH_PROVIDERS).join(", ")}`);
    process.exit(1);
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    // runLogin persists the credential AND upserts the provider entry to disk config.
    await runLogin(name, {
      onAuth: ({ url, instructions }) => {
        console.log(`\n🔐 Opening browser for ${name} login...\n${url}\n`);
        if (instructions) console.log(instructions);
        openBrowser(url);
      },
      onProgress: (m) => console.log(`   ${m}`),
      onManualCodeInput: () => new Promise((res) =>
        rl.question("Paste redirect URL or code (or wait for browser): ", res)),
    });
  } finally { rl.close(); }

  // [Audit fix #3] If a proxy is already running, push the provider into its LIVE config —
  // a disk save alone would not update the already-loaded server process.
  if (readPid()) {
    const cfg = loadConfig();
    try {
      await fetch(`http://localhost:${cfg.port}/api/providers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, provider: OAUTH_PROVIDERS[name].providerConfig }),
      });
    } catch { /* proxy unreachable; disk config loads on next start */ }
  }
  console.log(`\n✅ Logged in to ${name}. Try: ocx sync`);
}
```

### MODIFY files (Cycle 1)

#### `src/types.ts` — widen `authMode`
```diff
-  authMode?: "key" | "forward";
+  /**
+   * "key" (default): authenticate upstream with `apiKey`.
+   * "forward": relay the caller's incoming auth headers verbatim (OAuth passthrough; gpt only).
+   * "oauth": resolve a stored OAuth access token (auto-refreshed) and use it as the Bearer key.
+   */
+  authMode?: "key" | "forward" | "oauth";
```

#### `src/server.ts` — token resolution + OAuth endpoints
1. After routing in `handleResponses` (just before `resolveAdapter`):
```diff
   logCtx.model = route.modelId;
   logCtx.provider = route.providerName;
+
+  // OAuth providers: swap in a fresh access token as the Bearer key.
+  if (route.provider.authMode === "oauth") {
+    try {
+      const { getValidAccessToken } = await import("./oauth/index");
+      route.provider = { ...route.provider, apiKey: await getValidAccessToken(route.providerName) };
+    } catch (err) {
+      return formatErrorResponse(401, "authentication_error",
+        err instanceof Error ? err.message : String(err));
+    }
+  }

   const adapter = resolveAdapter(route.provider);
```
2. In `handleManagementAPI`, add concrete endpoints before `return null;`:
```ts
if (url.pathname === "/api/oauth/login" && req.method === "POST") {
  const body = await req.json().catch(() => ({})) as { provider?: string };
  const provider = (body.provider ?? "").trim().toLowerCase();
  const { isOAuthProvider, startLoginFlow, upsertOAuthProvider } = await import("./oauth/index");
  if (!isOAuthProvider(provider)) return jsonResponse({ error: "unknown oauth provider" }, 400);
  try {
    const { url: authUrl, instructions } = await startLoginFlow(provider);
    upsertOAuthProvider(config, provider); // mutate LIVE config — routing sees it without restart
    return jsonResponse({ url: authUrl, instructions });
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 409);
  }
}
if (url.pathname === "/api/oauth/status" && req.method === "GET") {
  const provider = (url.searchParams.get("provider") ?? "").trim().toLowerCase();
  const { getLoginStatus } = await import("./oauth/index");
  return jsonResponse(getLoginStatus(provider));
}
if (url.pathname === "/api/oauth/logout" && req.method === "POST") {
  const provider = (url.searchParams.get("provider") ?? "").trim().toLowerCase();
  const { removeCredential } = await import("./oauth/store");
  removeCredential(provider);
  return jsonResponse({ success: true });
}
```
**[Audit fix #4]** `startLoginFlow` returns as soon as the auth URL is ready; the xAI callback
server (port 56121) runs inside this same proxy process and captures the redirect in the
background, after which `runLogin` persists the credential. The GUI polls `/api/oauth/status`.
`upsertOAuthProvider(config, …)` mutates the live in-memory config so no restart is needed.

3. **[Audit fix #2]** `fetchAllModels` (server.ts:269-290) — use the shared resolver so OAuth
   providers' models are listed once logged in:
```diff
-    if (prov.authMode === "forward") return; // ChatGPT backend has no /models; gpt listed statically
-    const apiKey = resolveEnvValue(prov.apiKey);
+    if (prov.authMode === "forward") return; // ChatGPT backend has no /models; gpt listed statically
+    const { resolveModelsAuthToken } = await import("./oauth/index");
+    const apiKey = await resolveModelsAuthToken(name, prov);
+    if (prov.authMode === "oauth" && !apiKey) return; // not logged in → skip silently
     const headers: Record<string, string> = { ...(prov.headers ?? {}) };
     if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
```

#### `src/codex-catalog.ts` — OAuth model fetch [Audit fix #2]
`fetchProviderModels` (codex-catalog.ts:116-129) also resolves only `apiKey`, so `ocx sync` /
catalog injection would miss xAI models after login. Same shared-resolver fix:
```diff
 async function fetchProviderModels(name: string, prov: OcxProviderConfig): Promise<CatalogModel[]> {
   if (prov.authMode === "forward") return []; // ChatGPT backend has no /models
-  const apiKey = resolveEnvValue(prov.apiKey);
+  const { resolveModelsAuthToken } = await import("./oauth/index");
+  const apiKey = await resolveModelsAuthToken(name, prov);
+  if (prov.authMode === "oauth" && !apiKey) return []; // not logged in → skip
   const headers: Record<string, string> = { ...(prov.headers ?? {}) };
   if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
```
(`resolveEnvValue` import stays — still used elsewhere in the file.)

#### `src/cli.ts` — `login` / `logout` commands + usage
```diff
   case "status":
     handleStatus();
     break;
+  case "login": {
+    const { handleLogin } = await import("./oauth/login-cli");
+    await handleLogin(args[1]);
+    break;
+  }
+  case "logout": {
+    const { removeCredential } = await import("./oauth/store");
+    removeCredential((args[1] ?? "").trim().toLowerCase());
+    console.log(`Logged out of ${args[1]}.`);
+    break;
+  }
```
+ add `ocx login <provider>` / `ocx logout <provider>` lines to `printUsage()`.

#### GUI (minimal) — `gui/src/pages/Providers.tsx`
Add a small "OAuth Login" row: a **Login with xAI** button → `POST /api/oauth/login {provider:"xai"}`
→ `window.open(resp.url, "_blank")` (the new OAuth tab the user expects) → poll
`GET /api/oauth/status?provider=xai` every 1.5s until `loggedIn`, then show ✅ + email.
(Full provider selector UI is Cycle 2.)

### Verification (Cycle 1, THOROUGH — security tier)

- `npx tsc --noEmit` → 0 errors.
- Unit (bun): `generatePKCE()` returns 128-char base64url verifier + valid S256 challenge;
  `parseCallbackInput` extracts code/state from URL / query / raw; store.ts round-trips a credential.
- Auth-URL build: instantiate `XaiOAuthFlow`, assert the generated URL has the right host,
  client_id, scope, `code_challenge_method=S256`, and a `redirect_uri` of `127.0.0.1:56121`.
- **Headless e2e (if `~/.grok/auth.json` exists)**: `loginXai({importLocal:"only"})` → token →
  start proxy → `POST /v1/responses` with `model:"grok-4"` → assert a real completion. This proves
  the whole oauth→router→adapter→api.x.ai path without a browser.
- **Browser e2e (fallback)**: collaborative one-time `ocx login xai` with the user, then a real request.
- Independent reviewer (jaw employee) audits the plan (A) and the build (B).

---

## Cycle 2 — Anthropic + Kimi (sketch; detailed at its own P)

- **Anthropic** (`src/oauth/anthropic.ts`): port jawcode's flow — client `9d1c250a-…`, authorize
  `claude.ai/oauth/authorize`, token `api.anthropic.com/v1/oauth/token`, callback `:54545`, PKCE S256.
  **[Audit fix #5] The `anthropic` adapter is NOT zero-change**: `src/adapters/anthropic.ts:107`
  sets `x-api-key`, but OAuth needs `Authorization: Bearer <token>` + an `anthropic-beta: oauth-2025-04-20`
  header (confirm exact value against jawcode `providers/anthropic.ts` at that cycle's P). So Cycle 2
  must add an `authMode:"oauth"` branch to the anthropic adapter (or inject via `provider.headers`).
  This contrasts with xAI/Kimi, which ride the `openai-chat` Bearer path unchanged.
- **Kimi** (`src/oauth/kimi.ts`): **device-code** flow (no callback server) — poll
  `auth.kimi.com/api/oauth/token`; device-id persisted at `~/.opencodex/kimi-device-id`. Provider
  entry: `openai-chat` against the Kimi base URL, `authMode:"oauth"`.
- Register both in `OAUTH_PROVIDERS`. GUI: provider selector with all three.

## Cycle 3 — `ocx service` → `50_phase6_service_command.md`
