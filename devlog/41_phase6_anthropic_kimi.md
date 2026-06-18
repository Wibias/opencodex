# Phase 6 / Cycle 2 — Anthropic + Kimi true OAuth login

Extends the OAuth registry (xAI shipped in Cycle 1) with the two remaining high-value
account logins. Both buttons already exist in the GUI showing "coming soon" — registering them
in `OAUTH_PROVIDERS` makes those buttons go live automatically (no GUI change needed).

Classification: **C4** (credentials). Anthropic is headlessly verifiable (a Claude Code keychain
token exists); Kimi needs a live device login (flow wiring + real device-auth request verified).

## Anthropic OAuth — the make-or-break details (from jawcode providers/anthropic.ts)

Claude Pro/Max OAuth tokens are **not** `x-api-key` — they require, or requests 401/403:
1. `Authorization: Bearer <token>`
2. `anthropic-beta: claude-code-20250219,oauth-2025-04-20`
3. First system block = `"You are a Claude agent, built on Anthropic's Claude Agent SDK."` (`claudeCodeSystemInstruction`)
4. Custom tool names prefixed `proxy_` (except builtins web_search/code_execution/text_editor/computer) — `applyClaudeToolPrefix`. The response's `tool_use` names come back prefixed → must strip `proxy_` so Codex sees the original tool name.

## NEW files

### `src/oauth/anthropic.ts` (port of jawcode oauth/anthropic.ts)
`AnthropicOAuthFlow extends OAuthCallbackFlow` via the **number ctor** `super(ctrl, 54545, "/callback")`
(localhost bind, redirect `http://localhost:54545/callback`). client `atob("OWQx…")` =
`9d1c250a-e61b-44d9-88ed-5944d1962f5e`, authorize `https://claude.ai/oauth/authorize`, token
`https://api.anthropic.com/v1/oauth/token` (JSON POST, not urlencoded), scope
`org:create_api_key user:profile user:inference`, PKCE S256, authParams include `code:"true"`,
`exchangeToken` splits a `code#state` fragment. `loginAnthropic(ctrl,{importLocal})`,
`refreshAnthropicToken`. **Also export** OAuth-request constants for the adapter:
```ts
export const ANTHROPIC_OAUTH_BETA = "claude-code-20250219,oauth-2025-04-20";
export const CLAUDE_CODE_SYSTEM_INSTRUCTION = "You are a Claude agent, built on Anthropic's Claude Agent SDK.";
const CLAUDE_TOOL_PREFIX = "proxy_";
const ANTHROPIC_BUILTIN_TOOLS = new Set(["web_search", "code_execution", "text_editor", "computer"]);
export function applyClaudeToolPrefix(name: string): string {
  if (ANTHROPIC_BUILTIN_TOOLS.has(name.toLowerCase()) || name.toLowerCase().startsWith(CLAUDE_TOOL_PREFIX)) return name;
  return CLAUDE_TOOL_PREFIX + name;
}
export function stripClaudeToolPrefix(name: string): string {
  return name.startsWith(CLAUDE_TOOL_PREFIX) ? name.slice(CLAUDE_TOOL_PREFIX.length) : name;
}
```

### `src/oauth/kimi.ts` (port of jawcode oauth/kimi.ts — device-code flow)
Replace jawcode deps: `$env`→`process.env` (`KIMI_CODE_OAUTH_HOST||KIMI_OAUTH_HOST||https://auth.kimi.com`),
`getAgentDir()`→`getConfigDir()` (device-id at `~/.opencodex/kimi-device-id`), `isEnoent`→
`(e as {code?:string}).code==="ENOENT"`, `scheduler.wait(ms,{signal})`→ a local `sleep(ms,signal)`,
`packageJson.version`→ const `KIMI_CLI_VERSION="1.0.0"`. Keep `requestDeviceAuthorization`,
`pollForToken`, `loginKimi`(onAuth gives verification_uri_complete + "Enter code: <user_code>"),
`refreshKimiToken`, X-Msh-* common headers.

### MODIFY `src/oauth/local-token-detect.ts` — add `detectClaudeCodeToken()`
macOS keychain `security find-generic-password -s "Claude Code-credentials" -w` (linux: `secret-tool`),
parse `{claudeAiOauth:{accessToken,refreshToken,expiresAt}}` → OAuthCredentials. Enables headless verify.

## MODIFY files

### `src/oauth/index.ts` — register both
```ts
anthropic: { login: (c)=>loginAnthropic(c,{importLocal:"fallback"}), refresh: refreshAnthropicToken,
  providerConfig: { adapter:"anthropic", baseUrl:"https://api.anthropic.com", authMode:"oauth",
    models:[<verified at build>], defaultModel:<verified> }, defaultModel:<verified> },
kimi: { login: (c)=>loginKimi(c), refresh: refreshKimiToken,
  providerConfig: { adapter:"openai-chat", baseUrl:"https://api.kimi.com/coding/v1", authMode:"oauth",
    models:["kimi-k2.6","kimi-k2.5"], defaultModel:"kimi-k2.6" }, defaultModel:"kimi-k2.6" },
```

### `src/adapters/anthropic.ts` — OAuth branch
- headers: `if (provider.authMode==="oauth"){ headers.Authorization=`Bearer ${provider.apiKey}`; headers["anthropic-beta"]=ANTHROPIC_OAUTH_BETA; } else if (provider.apiKey) headers["x-api-key"]=provider.apiKey;`
- system (oauth): `body.system = [{type:"text",text:CLAUDE_CODE_SYSTEM_INSTRUCTION}, ...(system?[{type:"text",text:system}]:[])]` instead of the plain string.
- tools (oauth): map `name → applyClaudeToolPrefix(name)` in `toolsToAnthropicFormat`.
- parseStream + parseResponse (oauth): `name = stripClaudeToolPrefix(block.name)` on every `tool_use` so Codex gets the original tool name. (Thread an `oauth` flag through the adapter closure.)

## GUI
No change — `anthropic`/`kimi` presets already exist; once in `OAUTH_PROVIDERS`, `/api/oauth/providers`
returns them and the "coming soon" turns into a working "Log in with …" button.

## Verification (C4 / THOROUGH)
- tsc backend + GUI.
- **Anthropic headless e2e**: import Claude Code keychain token → real `POST api.anthropic.com/v1/messages`
  with Bearer+beta+Claude-Code-system+a `proxy_`-prefixed tool → assert 200 + content (determines the
  working model id for the registry). Then a full proxy round-trip `/v1/responses (anthropic/<model>)`→ text.
- **Kimi**: tsc + a real `POST auth.kimi.com/api/oauth/device_authorization` returns a user_code +
  verification URL (proves the device flow up to human approval); flow wiring unit-checked. Live device
  login by the user.
- Independent adversarial review of the diff.
