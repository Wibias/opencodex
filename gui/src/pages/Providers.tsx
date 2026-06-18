import { useEffect, useState } from "react";
import AddProviderModal from "../components/AddProviderModal";

interface Config {
  port: number;
  defaultProvider: string;
  providers: Record<string, { adapter: string; baseUrl: string; apiKey?: string; defaultModel?: string }>;
}

export default function Providers({ apiBase }: { apiBase: string }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("");
  const [oauth, setOauth] = useState<{ loggedIn: boolean; email?: string; error?: string }>({ loggedIn: false });
  const [oauthBusy, setOauthBusy] = useState(false);

  const fetchConfig = async () => {
    try {
      const res = await fetch(`${apiBase}/api/config`);
      const data = await res.json();
      setConfig(data);
      setDraft(JSON.stringify(data, null, 2));
    } catch {
      setStatus("Failed to load config");
    }
  };

  useEffect(() => { fetchConfig(); }, [apiBase]);

  const saveConfig = async () => {
    try {
      const parsed = JSON.parse(draft);
      const res = await fetch(`${apiBase}/api/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      if (res.ok) {
        setStatus("Saved! Restart proxy to apply.");
        setEditing(false);
        fetchConfig();
      } else {
        setStatus("Save failed");
      }
    } catch {
      setStatus("Invalid JSON");
    }
  };

  const refreshOauth = async () => {
    try {
      const res = await fetch(`${apiBase}/api/oauth/status?provider=xai`);
      setOauth(await res.json());
    } catch { /* ignore */ }
  };
  useEffect(() => { refreshOauth(); }, [apiBase]);

  const loginXai = async () => {
    setOauthBusy(true);
    setStatus("");
    try {
      const res = await fetch(`${apiBase}/api/oauth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "xai" }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) { setStatus(data.error || "Login failed to start"); return; }
      window.open(data.url, "_blank");
      for (let i = 0; i < 100; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const s = await fetch(`${apiBase}/api/oauth/status?provider=xai`).then(r => r.json()).catch(() => null);
        if (s?.loggedIn) { setOauth(s); setStatus("✅ Logged in to xai. Run ocx sync to list its models."); fetchConfig(); break; }
        if (s?.error) { setOauth(s); setStatus(`xai login error: ${s.error}`); break; }
      }
    } catch {
      setStatus("Login request failed");
    } finally {
      setOauthBusy(false);
    }
  };

  const logoutXai = async () => {
    await fetch(`${apiBase}/api/oauth/logout?provider=xai`, { method: "POST" }).catch(() => {});
    setOauth({ loggedIn: false });
    setStatus("Logged out of xai.");
    fetchConfig();
  };

  if (!config) return <div>Loading...</div>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h3 style={{ fontSize: 16, margin: 0 }}>Provider Configuration</h3>
        <div style={{ display: "flex", gap: 8 }}>
          {editing ? (
            <>
              <button onClick={saveConfig} style={btnStyle("#3b82f6")}>Save</button>
              <button onClick={() => { setEditing(false); setDraft(JSON.stringify(config, null, 2)); }} style={btnStyle("#888")}>Cancel</button>
            </>
          ) : (
            <>
              <button onClick={() => setAdding(true)} style={btnStyle("#3b82f6")}>Add Provider</button>
              <button onClick={() => setEditing(true)} style={btnStyle("#9ca3af")}>Edit JSON</button>
            </>
          )}
        </div>
      </div>
      {status && <div style={{ fontSize: 13, color: status.includes("Saved") || status.includes("✅") ? "#22c55e" : "#ef4444", marginBottom: 12 }}>{status}</div>}
      <div style={{ background: "#f0f9ff", borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>OAuth Login</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 13 }}>
            xAI (Grok): {oauth.loggedIn
              ? <strong style={{ color: "#22c55e" }}>logged in{oauth.email ? ` (${oauth.email})` : ""}</strong>
              : <span style={{ color: "#888" }}>not logged in</span>}
          </span>
          {oauth.loggedIn ? (
            <button onClick={logoutXai} style={btnStyle("#888")}>Logout</button>
          ) : (
            <button onClick={loginXai} disabled={oauthBusy} style={btnStyle(oauthBusy ? "#9ca3af" : "#3b82f6")}>
              {oauthBusy ? "Waiting for browser…" : "Login with xAI"}
            </button>
          )}
        </div>
      </div>
      {editing ? (
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          style={{ width: "100%", height: 400, fontFamily: "monospace", fontSize: 13, padding: 12, borderRadius: 8, border: "1px solid #e5e7eb", resize: "vertical" }}
        />
      ) : (
        <div>
          <div style={{ fontSize: 13, color: "#888", marginBottom: 8 }}>Port: {config.port} · Default: {config.defaultProvider}</div>
          {Object.entries(config.providers).map(([name, prov]) => (
            <div key={name} style={{ background: "#f9fafb", borderRadius: 8, padding: 16, marginBottom: 8 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{name}</div>
              <div style={{ fontSize: 13, color: "#666" }}>
                Adapter: <code>{prov.adapter}</code> · URL: {prov.baseUrl}
                {prov.defaultModel && <> · Model: {prov.defaultModel}</>}
                {prov.apiKey && <> · Key: {prov.apiKey}</>}
              </div>
            </div>
          ))}
        </div>
      )}
      {adding && (
        <AddProviderModal
          apiBase={apiBase}
          existingNames={Object.keys(config.providers)}
          onClose={() => setAdding(false)}
          onAdded={(name) => { setAdding(false); setStatus(`Added "${name}". Live now — run ocx sync (or restart) to list its models in Codex's picker.`); fetchConfig(); }}
        />
      )}
    </div>
  );
}

const btnStyle = (bg: string) => ({
  padding: "6px 14px", borderRadius: 6, border: "none", background: bg,
  color: "#fff", fontSize: 13, cursor: "pointer" as const,
});
