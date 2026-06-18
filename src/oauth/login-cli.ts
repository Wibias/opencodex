import * as readline from "node:readline";
import { exec } from "node:child_process";
import { loadConfig, readPid } from "../config";
import { OAUTH_PROVIDERS, runLogin } from "./index";

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? 'start ""' : "xdg-open";
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
      onManualCodeInput: () =>
        new Promise((res) => rl.question("Paste redirect URL or code (or wait for browser): ", res)),
    });
  } finally {
    rl.close();
  }

  // If a proxy is already running, push the provider into its LIVE config — a disk save alone
  // would not update the already-loaded server process.
  if (readPid()) {
    const cfg = loadConfig();
    try {
      await fetch(`http://localhost:${cfg.port}/api/providers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, provider: OAUTH_PROVIDERS[name].providerConfig }),
      });
    } catch {
      /* proxy unreachable; disk config loads on next start */
    }
  }

  console.log(`\n✅ Logged in to ${name}. Try: ocx sync`);
}
