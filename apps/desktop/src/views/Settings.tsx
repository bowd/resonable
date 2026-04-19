import { useState } from "react";
import { platform } from "../platform";

export function SettingsView() {
  const [llmBase, setLlmBase] = useState(localStorage.getItem("resonable.llm.baseUrl") ?? "http://localhost:11434");
  const [model, setModel] = useState(localStorage.getItem("resonable.llm.model") ?? "llama3.2");
  const [syncPeer, setSyncPeer] = useState(localStorage.getItem("resonable.sync.peer") ?? "");
  const [brokerUrl, setBrokerUrl] = useState(localStorage.getItem("resonable.broker.url") ?? "");
  const [demo, setDemo] = useState(localStorage.getItem("resonable.demo") === "1");

  function save() {
    localStorage.setItem("resonable.llm.baseUrl", llmBase);
    localStorage.setItem("resonable.llm.model", model);
    if (syncPeer) localStorage.setItem("resonable.sync.peer", syncPeer);
    else localStorage.removeItem("resonable.sync.peer");
    if (brokerUrl) localStorage.setItem("resonable.broker.url", brokerUrl);
    else localStorage.removeItem("resonable.broker.url");
    if (demo) localStorage.setItem("resonable.demo", "1");
    else localStorage.removeItem("resonable.demo");
    location.reload();
  }

  return (
    <>
      <h2>Settings</h2>
      <div className="card">
        <strong>Local LLM</strong>
        <label>Base URL (Ollama)</label>
        <input value={llmBase} onChange={(e) => setLlmBase(e.target.value)} />
        <label>Model</label>
        <input value={model} onChange={(e) => setModel(e.target.value)} />
      </div>
      <div className="card">
        <strong>Demo mode</strong>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
          <input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} style={{ width: "auto" }} />
          <span>Use fixture bank client (Revolut + N26 sample data, no network)</span>
        </label>
      </div>
      <div className="card">
        <strong>Sync</strong>
        <div className="muted">
          Runtime: {platform.mode} ({platform.isNative ? "native" : "web"})
        </div>
        <label>Custom sync peer (leave blank for Jazz Mesh)</label>
        <input
          placeholder="wss://..."
          value={syncPeer}
          onChange={(e) => setSyncPeer(e.target.value)}
        />
      </div>
      {!platform.isNative && (
        <div className="card">
          <strong>Bank data broker (web fallback)</strong>
          <div className="muted">
            Needed because browsers can't call GoCardless directly. Run your own stateless broker per household.
          </div>
          <label>Broker URL</label>
          <input
            placeholder="https://broker.example.com"
            value={brokerUrl}
            onChange={(e) => setBrokerUrl(e.target.value)}
          />
        </div>
      )}
      <div className="card">
        <button className="primary" onClick={save}>Save & reload</button>
      </div>
    </>
  );
}
