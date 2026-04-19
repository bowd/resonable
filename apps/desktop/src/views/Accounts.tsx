import { useEffect, useRef, useState } from "react";
import type { LoadedAccount, LoadedHousehold } from "@resonable/schema";
import { useCurrentAccount, useFirstHousehold } from "../jazz";
import { fixtureBank, platform } from "../platform";
import { importAccountForConnection, syncAccount } from "../data/import";
import { ensureBankCredsReady, MissingCredentialsError } from "../data/gocardless-creds";

type PendingRequisition = {
  requisitionId: string;
  connectionId: string;
  institutionId: "REVOLUT_REVOLT21" | "N26_NTSBDEB1";
  institutionName: string;
  link: string;
  startedAt: string;
  lastStatus?: string;
  lastError?: string;
};

const PENDING_STORAGE_KEY = "resonable.pending-requisitions";
const POLL_INTERVAL_MS = 5_000;
const TIMEOUT_MS = 10 * 60 * 1000;

function loadPending(): PendingRequisition[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(PENDING_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is PendingRequisition =>
      !!p && typeof p === "object" &&
      typeof (p as PendingRequisition).requisitionId === "string" &&
      typeof (p as PendingRequisition).connectionId === "string" &&
      typeof (p as PendingRequisition).institutionName === "string" &&
      typeof (p as PendingRequisition).link === "string" &&
      typeof (p as PendingRequisition).startedAt === "string",
    );
  } catch {
    return [];
  }
}

function savePending(list: PendingRequisition[]) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // best effort
  }
}

export function AccountsView() {
  const { household } = useFirstHousehold();
  const [showArchived, setShowArchived] = useState(false);

  if (!household) {
    return (
      <>
        <h2>Accounts</h2>
        <p className="muted">Create a household first.</p>
      </>
    );
  }

  const accounts = household.accounts as unknown as ReadonlyArray<LoadedAccount>;
  const live = accounts.filter((a) => a && !a.archived);
  const archived = accounts.filter((a) => a && a.archived);

  return (
    <>
      <h2>Accounts in {household.name}</h2>
      <p className="muted">
        Each linked bank connection is owned by the member who provides the
        GoCardless credentials. Transactions replicate to every household
        member via the shared Group.
      </p>
      {archived.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <button
            onClick={() => setShowArchived((v) => !v)}
            style={{ fontSize: 12 }}
          >
            {showArchived ? "Hide" : "Show"} archived ({archived.length})
          </button>
        </div>
      )}
      {live.map((acc, i) => (
        <AccountCard key={`live-${i}`} account={acc} household={household} />
      ))}
      {showArchived &&
        archived.map((acc, i) => (
          <AccountCard key={`arch-${i}`} account={acc} household={household} />
        ))}
      <LinkBankForm household={household} />
    </>
  );
}

function AccountCard({ account, household }: { account: LoadedAccount; household: LoadedHousehold }) {
  const me = useCurrentAccount();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function resync() {
    if (!me.$isLoaded) return;
    setBusy(true); setMsg(null);
    try {
      const group = household.$jazz.owner;
      const connectionId = `${household.$jazz.id}:${me.$jazz.id}`;
      if (platform.mode !== "fixture") {
        try {
          await ensureBankCredsReady(platform.bankData, platform.secrets, connectionId);
        } catch (err) {
          if (err instanceof MissingCredentialsError) {
            setMsg("No GoCardless credentials. Open Settings \u2192 Bank data.");
            return;
          }
          throw err;
        }
      }
      const res = await syncAccount({
        bank: platform.bankData,
        connectionId,
        account,
        group,
      });
      setMsg(`+${res.added.length} new, ${res.skipped} skipped`);
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function toggleArchive() {
    account.$jazz.set("archived", !account.archived);
  }

  const archived = account.archived;

  return (
    <div className="card" style={archived ? { opacity: 0.55 } : undefined}>
      <div className="row">
        <div>
          <strong>{account.name}</strong>
          <span className="pill">{account.currency}</span>
          {archived && <span className="pill" style={{ marginLeft: 4 }}>archived</span>}
          <div className="muted">{account.institutionName} \u2022 {account.iban ?? "\u2014"}</div>
        </div>
        <div style={{ textAlign: "right", display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
          <div className="muted">{account.transactions.length} tx</div>
          <div style={{ display: "flex", gap: 6 }}>
            {!archived && (
              <button onClick={resync} disabled={busy} className="primary" style={{ fontSize: 12 }}>
                {busy ? "syncing\u2026" : "Sync"}
              </button>
            )}
            <button onClick={toggleArchive} style={{ fontSize: 12 }}>
              {archived ? "Unarchive" : "Archive"}
            </button>
          </div>
          {msg && <div className="muted" style={{ marginTop: 4 }}>{msg}</div>}
        </div>
      </div>
    </div>
  );
}

function LinkBankForm({ household }: { household: LoadedHousehold }) {
  const me = useCurrentAccount();
  const [country, setCountry] = useState("AT");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingRequisition[]>(() => loadPending());
  const pendingRef = useRef<PendingRequisition[]>(pending);
  const [now, setNow] = useState<number>(() => Date.now());
  const demo = fixtureBank();

  // Keep ref in sync and persist every change.
  useEffect(() => {
    pendingRef.current = pending;
    savePending(pending);
  }, [pending]);

  // 1Hz clock for elapsed-time rendering.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // 5s poll loop for pending requisitions.
  useEffect(() => {
    if (!me.$isLoaded) return;
    const tick = async () => {
      const list = pendingRef.current;
      if (list.length === 0) return;
      for (const entry of list) {
        const age = Date.now() - new Date(entry.startedAt).getTime();
        if (age >= TIMEOUT_MS) continue; // stop auto-polling once timed out
        await checkRequisition(entry, /*manual*/ false);
      }
    };
    const id = setInterval(() => { void tick(); }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.$isLoaded ? me.$jazz.id : null]);

  function updatePending(requisitionId: string, patch: Partial<PendingRequisition>) {
    setPending((prev) => prev.map((p) => p.requisitionId === requisitionId ? { ...p, ...patch } : p));
  }

  function removePending(requisitionId: string) {
    setPending((prev) => prev.filter((p) => p.requisitionId !== requisitionId));
  }

  async function checkRequisition(entry: PendingRequisition, _manual: boolean) {
    if (!me.$isLoaded) return;
    try {
      const res = await platform.bankData.getRequisition(entry.connectionId, entry.requisitionId);
      if (res.status === "LN") {
        const group = household.$jazz.owner;
        const accounts = await importAccountForConnection({
          bank: platform.bankData,
          connectionId: entry.connectionId,
          requisitionId: entry.requisitionId,
          household,
          group,
          meAccountId: me.$jazz.id,
          institutionName: entry.institutionName,
        });
        removePending(entry.requisitionId);
        setStatus(`Linked ${accounts.length} account(s) from ${entry.institutionName}.`);
        return;
      }
      updatePending(entry.requisitionId, { lastStatus: res.status, lastError: undefined });
    } catch (err) {
      updatePending(entry.requisitionId, { lastError: (err as Error).message });
    }
  }

  async function linkBank(which: "REVOLUT_REVOLT21" | "N26_NTSBDEB1") {
    if (!me.$isLoaded) return;
    setBusy(true); setStatus(null);
    try {
      const group = household.$jazz.owner;
      const connectionId = `${household.$jazz.id}:${me.$jazz.id}`;
      // Real mode requires GoCardless credentials; demo mode skips token mint.
      if (!demo) {
        try {
          await ensureBankCredsReady(platform.bankData, platform.secrets, connectionId);
        } catch (err) {
          if (err instanceof MissingCredentialsError) {
            setStatus("No GoCardless credentials. Open Settings \u2192 Bank data to add them.");
            return;
          }
          throw err;
        }
      }
      const req = await platform.bankData.createRequisition(connectionId, {
        institutionId: which,
        redirectUrl: "resonable://oauth/callback",
        reference: connectionId,
      });
      const institutionName = which.startsWith("REVOLUT") ? "Revolut" : "N26";
      if (!demo) {
        const entry: PendingRequisition = {
          requisitionId: req.id,
          connectionId,
          institutionId: which,
          institutionName,
          link: req.link,
          startedAt: new Date().toISOString(),
        };
        setPending((prev) => [...prev.filter((p) => p.requisitionId !== entry.requisitionId), entry]);
        if (typeof window !== "undefined") {
          window.open(req.link, "_blank", "noopener,noreferrer");
        }
        setStatus(`Opened consent page for ${institutionName}. Waiting for consent\u2026`);
        return;
      }
      // Fixture mode: skip consent, go straight to materialization.
      const accounts = await importAccountForConnection({
        bank: platform.bankData,
        connectionId,
        requisitionId: req.id,
        household,
        group,
        meAccountId: me.$jazz.id,
        institutionName,
        accountMeta: (id) => demo.accountMeta(id),
      });
      setStatus(`Linked ${accounts.length} account(s) with fixture data.`);
    } catch (err) {
      setStatus(`Error: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      {demo && (
        <p className="muted">
          Demo mode (fixture bank client) is active. Disable it in Settings to use a real
          GoCardless connection via Tauri or a self-hosted broker.
        </p>
      )}
      <label>Country</label>
      <input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))} />
      <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
        <button className="primary" disabled={busy} onClick={() => linkBank("REVOLUT_REVOLT21")}>
          Link Revolut
        </button>
        <button className="primary" disabled={busy} onClick={() => linkBank("N26_NTSBDEB1")}>
          Link N26
        </button>
      </div>
      {status && <p className="muted" style={{ marginTop: 8 }}>{status}</p>}
      {pending.map((p) => (
        <PendingRequisitionCard
          key={p.requisitionId}
          entry={p}
          now={now}
          onCheck={() => { void checkRequisition(p, true); }}
          onReopen={() => {
            if (typeof window !== "undefined") {
              window.open(p.link, "_blank", "noopener,noreferrer");
            }
          }}
          onCancel={() => removePending(p.requisitionId)}
        />
      ))}
    </div>
  );
}

function PendingRequisitionCard(props: {
  entry: PendingRequisition;
  now: number;
  onCheck: () => void;
  onReopen: () => void;
  onCancel: () => void;
}) {
  const { entry, now, onCheck, onReopen, onCancel } = props;
  const started = new Date(entry.startedAt).getTime();
  const elapsedMs = Math.max(0, now - started);
  const timedOut = elapsedMs >= TIMEOUT_MS;
  const seconds = Math.floor(elapsedMs / 1000);
  const mm = Math.floor(seconds / 60).toString().padStart(2, "0");
  const ss = (seconds % 60).toString().padStart(2, "0");

  const terminalError =
    entry.lastStatus === "RJ" || entry.lastStatus === "EX"
      ? `Consent ${entry.lastStatus === "RJ" ? "rejected" : "expired"} (${entry.lastStatus}). Cancel and try again.`
      : null;

  return (
    <div className="card" style={{ marginTop: 8 }}>
      <div className="row">
        <div>
          <strong>{entry.institutionName}</strong>
          <span className="pill">waiting for consent</span>
          <div className="muted">
            elapsed {mm}:{ss}
            {entry.lastStatus ? ` \u2022 status ${entry.lastStatus}` : ""}
          </div>
          {timedOut && !terminalError && (
            <div className="muted" style={{ marginTop: 4 }}>
              timed out \u2014 click Check now to retry
            </div>
          )}
          {terminalError && (
            <div className="muted" style={{ marginTop: 4 }}>{terminalError}</div>
          )}
          {entry.lastError && (
            <div className="muted" style={{ marginTop: 4 }}>Error: {entry.lastError}</div>
          )}
        </div>
        <div style={{ textAlign: "right", display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button onClick={onReopen} style={{ fontSize: 12 }}>Reopen consent page</button>
          <button onClick={onCheck} className="primary" style={{ fontSize: 12 }}>Check now</button>
          <button onClick={onCancel} style={{ fontSize: 12 }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
