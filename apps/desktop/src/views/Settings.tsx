import { useEffect, useState } from "react";
import { platform } from "../platform";
import {
  deserializeBackup,
  envelopeToBlob,
  parseEnvelope,
  serializeBackup,
  WrongPassphraseError,
  type BackupPayload,
} from "@resonable/core";
import { useCurrentAccount, useFirstHousehold } from "../jazz";
import {
  applyBackupPayload,
  toBackupPayload,
  type BackupApplyResult,
} from "../data/backup-mapping";
import {
  clearGoCardlessCreds,
  loadGoCardlessCreds,
  saveGoCardlessCreds,
} from "../data/gocardless-creds";

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
      <BankDataCard />
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
      <BackupCard />
      <div className="card">
        <button className="primary" onClick={save}>Save & reload</button>
      </div>
    </>
  );
}

/**
 * Backup UI: passphrase-encrypted export + import for the active household.
 * State is co-located here because the flow is self-contained and never
 * leaves this card.
 */
function BackupCard() {
  const { household } = useFirstHousehold();
  const me = useCurrentAccount();

  // Export form state
  const [pp1, setPp1] = useState("");
  const [pp2, setPp2] = useState("");
  const [insecure, setInsecure] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [exportErr, setExportErr] = useState<string | null>(null);

  // Import form state
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPp, setImportPp] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importErr, setImportErr] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<BackupApplyResult | null>(null);

  const householdReady = !!household;

  async function doExport() {
    if (!household) return;
    setExportErr(null);
    setExportMsg(null);
    if (!insecure) {
      if (pp1.length < 8) {
        setExportErr("Passphrase must be at least 8 characters.");
        return;
      }
      if (pp1 !== pp2) {
        setExportErr("Passphrases do not match.");
        return;
      }
    }
    setExportBusy(true);
    try {
      const payload: BackupPayload = toBackupPayload(household);
      if (insecure) {
        const json = JSON.stringify(payload, null, 2);
        const bytes = new TextEncoder().encode(json);
        const datePart = payload.createdAt.slice(0, 10);
        downloadBytes(bytes, `resonable-backup-${datePart}.plain.json`, "application/json");
        setExportMsg(
          `Wrote plaintext backup (${bytes.byteLength} bytes). This file is NOT encrypted — delete it once you're done.`,
        );
      } else {
        const env = await serializeBackup(payload, pp1);
        const { bytes, suggestedFilename } = envelopeToBlob(env);
        downloadBytes(bytes, suggestedFilename, "application/json");
        setExportMsg(`Wrote encrypted backup (${bytes.byteLength} bytes) as ${suggestedFilename}.`);
        setPp1("");
        setPp2("");
      }
    } catch (err) {
      setExportErr((err as Error).message);
    } finally {
      setExportBusy(false);
    }
  }

  async function doImport() {
    if (!household || !me.$isLoaded || !importFile) return;
    setImportErr(null);
    setImportResult(null);
    setImportBusy(true);
    try {
      const text = await importFile.text();
      let payload: BackupPayload;
      try {
        // Try encrypted-envelope form first.
        const env = parseEnvelope(text);
        payload = await deserializeBackup(env, importPp);
      } catch (err) {
        if (err instanceof WrongPassphraseError) {
          setImportErr("Wrong passphrase");
          return;
        }
        // Not an envelope — fall back to plaintext payload.
        const parsed = JSON.parse(text) as BackupPayload;
        if (parsed.version !== 1) {
          throw new Error(`unsupported payload version: ${parsed.version as unknown as string}`);
        }
        payload = parsed;
      }
      const group = household.$jazz.owner;
      const result = applyBackupPayload(
        { household, meAccountId: me.$jazz.id, group },
        payload,
      );
      setImportResult(result);
      setImportPp("");
      setImportFile(null);
    } catch (err) {
      if (err instanceof WrongPassphraseError) {
        setImportErr("Wrong passphrase");
      } else {
        setImportErr((err as Error).message);
      }
    } finally {
      setImportBusy(false);
    }
  }

  return (
    <div className="card">
      <strong>Backup</strong>
      <div className="muted" style={{ marginBottom: 8 }}>
        Export this household as a passphrase-encrypted JSON file, or restore a
        previous backup. Encrypted backups use AES-256-GCM + PBKDF2; lose the
        passphrase and the file cannot be recovered.
      </div>

      {!householdReady && (
        <div className="muted">Create or join a household first.</div>
      )}

      {householdReady && (
        <>
          <div style={{ marginTop: 4 }}>
            <strong style={{ fontSize: 13 }}>Export</strong>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
            <input
              type="checkbox"
              checked={insecure}
              onChange={(e) => setInsecure(e.target.checked)}
              style={{ width: "auto" }}
            />
            <span>Export unencrypted (&#9888; insecure, for debugging)</span>
          </label>
          {!insecure && (
            <>
              <label>Passphrase (&ge; 8 characters)</label>
              <input
                type="password"
                value={pp1}
                onChange={(e) => setPp1(e.target.value)}
                placeholder="correct horse battery staple"
              />
              <label>Confirm passphrase</label>
              <input
                type="password"
                value={pp2}
                onChange={(e) => setPp2(e.target.value)}
              />
            </>
          )}
          <div style={{ marginTop: 8 }}>
            <button className="primary" onClick={() => { void doExport(); }} disabled={exportBusy}>
              {exportBusy ? "Exporting\u2026" : insecure ? "Export unencrypted backup" : "Export encrypted backup"}
            </button>
          </div>
          {exportErr && <div className="muted" style={{ color: "#dc2626", marginTop: 6 }}>{exportErr}</div>}
          {exportMsg && <div className="muted" style={{ marginTop: 6 }}>{exportMsg}</div>}

          <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "16px 0" }} />

          <div>
            <strong style={{ fontSize: 13 }}>Import</strong>
          </div>
          <div className="muted" style={{ marginTop: 4 }}>
            Imports merge into this household: duplicate accounts / transactions
            (by bank id), categories / tags (by name) and rules (by
            name+spec) are skipped.
          </div>
          <label>Backup file (.json)</label>
          <input
            type="file"
            accept="application/json,.json"
            onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
          />
          <label>Passphrase (leave blank for unencrypted backups)</label>
          <input
            type="password"
            value={importPp}
            onChange={(e) => setImportPp(e.target.value)}
          />
          <div style={{ marginTop: 8 }}>
            <button
              className="primary"
              onClick={() => { void doImport(); }}
              disabled={importBusy || !importFile || !me.$isLoaded}
            >
              {importBusy ? "Importing\u2026" : "Import backup"}
            </button>
          </div>
          {importErr && <div className="muted" style={{ color: "#dc2626", marginTop: 6 }}>{importErr}</div>}
          {importResult && (
            <div className="muted" style={{ marginTop: 6 }}>
              Added {importResult.addedCounts.accounts} account(s),{" "}
              {importResult.addedCounts.transactions} transaction(s),{" "}
              {importResult.addedCounts.labels} label(s),{" "}
              {importResult.addedCounts.categories} categor{importResult.addedCounts.categories === 1 ? "y" : "ies"},{" "}
              {importResult.addedCounts.tags} tag(s),{" "}
              {importResult.addedCounts.rules} rule(s).
            </div>
          )}
        </>
      )}
    </div>
  );
}

function BankDataCard() {
  const [secretId, setSecretId] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // Only Tauri has an always-available SecretStore. The web fallback needs
    // a passphrase unlock we don't wire up here.
    if (!platform.isNative) { setConfigured(false); return; }
    (async () => {
      const existing = await loadGoCardlessCreds(platform.secrets);
      setConfigured(existing !== null);
      if (existing) setSecretId(existing.secretId);
    })().catch(() => setConfigured(false));
  }, []);

  if (!platform.isNative) {
    return (
      <div className="card">
        <strong>Bank data (GoCardless)</strong>
        <div className="muted" style={{ marginTop: 4 }}>
          Web mode can't hold OS-keychain credentials. Run the desktop app
          (Tauri) to store GoCardless secrets, or use demo mode with the
          built-in Revolut / N26 fixture data.
        </div>
      </div>
    );
  }

  async function save() {
    if (!secretId.trim() || !secretKey.trim()) {
      setErr("Both secret_id and secret_key are required.");
      return;
    }
    setBusy(true); setErr(null); setMsg(null);
    try {
      await saveGoCardlessCreds(platform.secrets, {
        secretId: secretId.trim(),
        secretKey: secretKey.trim(),
      });
      setConfigured(true);
      setSecretKey("");
      setMsg("Saved. Next bank action will mint tokens and verify.");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      await clearGoCardlessCreds(platform.secrets);
      setConfigured(false);
      setSecretId("");
      setSecretKey("");
      setMsg("Credentials removed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <strong>Bank data (GoCardless)</strong>
      <div className="muted" style={{ marginTop: 2 }}>
        Register a free app at{" "}
        <a
          href="https://bankaccountdata.gocardless.com/user/signup"
          target="_blank"
          rel="noopener noreferrer"
        >
          bankaccountdata.gocardless.com
        </a>{" "}
        and paste the secret_id / secret_key here. Secrets are stored in your
        OS keychain ({platform.mode === "tauri" ? "native" : "web fallback"})
        and never leave the device.
      </div>
      <label>secret_id</label>
      <input
        value={secretId}
        onChange={(e) => setSecretId(e.target.value)}
        placeholder="00000000-0000-0000-0000-000000000000"
        spellCheck={false}
        autoComplete="off"
      />
      <label>secret_key {configured && "(leave blank to keep existing)"}</label>
      <input
        type="password"
        value={secretKey}
        onChange={(e) => setSecretKey(e.target.value)}
        placeholder={configured ? "\u2022\u2022\u2022\u2022 stored" : "paste secret_key"}
        spellCheck={false}
        autoComplete="off"
      />
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button className="primary" onClick={save} disabled={busy}>Save</button>
        {configured && (
          <button onClick={clear} disabled={busy}>Remove</button>
        )}
        <span className="muted" style={{ marginLeft: "auto", alignSelf: "center" }}>
          {configured === null ? "\u2026" : configured ? "configured" : "not configured"}
        </span>
      </div>
      {err && <div className="muted" style={{ color: "#dc2626", marginTop: 6 }}>{err}</div>}
      {msg && <div className="muted" style={{ marginTop: 6 }}>{msg}</div>}
    </div>
  );
}

function downloadBytes(bytes: Uint8Array, filename: string, mime: string) {
  // Create a detached copy in a fresh ArrayBuffer so Blob doesn't retain a view
  // over Jazz-owned memory.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    // Revoke on next tick so the browser has had a chance to start the download.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
