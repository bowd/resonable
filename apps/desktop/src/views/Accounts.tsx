import { useEffect, useRef, useState } from "react";
import { Group } from "jazz-tools";
import { Account, Household } from "@resonable/schema";
import { useAccount } from "../jazz";
import { fixtureBank, platform } from "../platform";
import { importAccountForConnection, syncAccount } from "../data/import";

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
  const { me } = useAccount();
  const firstHousehold = me?.profile?.households?.[0]?.household;

  if (!firstHousehold) {
    return (
      <>
        <h2>Accounts</h2>
        <p className="muted">Create a household first.</p>
      </>
    );
  }

  return (
    <>
      <h2>Accounts in {firstHousehold.name}</h2>
      <p className="muted">
        Each linked bank connection is owned by the member who provides the
        GoCardless credentials. Transactions replicate to every household
        member via the shared Group.
      </p>
      {firstHousehold.accounts?.map((acc, i) => acc ? (
        <AccountCard key={i} account={acc} household={firstHousehold} />
      ) : null)}
      <LinkBankForm household={firstHousehold} />
    </>
  );
}

function AccountCard({ account, household }: { account: Account; household: Household }) {
  const { me } = useAccount();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function resync() {
    if (!me) return;
    setBusy(true); setMsg(null);
    try {
      const group = household._owner.castAs(Group);
      const connectionId = `${household.id}:${me.id}`;
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

  return (
    <div className="card">
      <div className="row">
        <div>
          <strong>{account.name}</strong>
          <span className="pill">{account.currency}</span>
          <div className="muted">{account.institutionName} \u2022 {account.iban ?? "\u2014"}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="muted">{account.transactions?.length ?? 0} tx</div>
          <button onClick={resync} disabled={busy} className="primary" style={{ marginTop: 4, fontSize: 12 }}>
            {busy ? "syncing\u2026" : "Sync"}
          </button>
          {msg && <div className="muted" style={{ marginTop: 4 }}>{msg}</div>}
        </div>
      </div>
    </div>
  );
}

function LinkBankForm({ household }: { household: Household }) {
  const { me } = useAccount();
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
    if (!me) return;
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
  }, [me?.id]);

  function updatePending(requisitionId: string, patch: Partial<PendingRequisition>) {
    setPending((prev) => prev.map((p) => p.requisitionId === requisitionId ? { ...p, ...patch } : p));
  }

  function removePending(requisitionId: string) {
    setPending((prev) => prev.filter((p) => p.requisitionId !== requisitionId));
  }

  async function checkRequisition(entry: PendingRequisition, _manual: boolean) {
    if (!me) return;
    try {
      const res = await platform.bankData.getRequisition(entry.connectionId, entry.requisitionId);
      if (res.status === "LN") {
        const group = household._owner.castAs(Group);
        const accounts = await importAccountForConnection({
          bank: platform.bankData,
          connectionId: entry.connectionId,
          requisitionId: entry.requisitionId,
          household,
          group,
          meAccountId: me.id,
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
    if (!me) return;
    setBusy(true); setStatus(null);
    try {
      const group = household._owner.castAs(Group);
      const connectionId = `${household.id}:${me.id}`;
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
        meAccountId: me.id,
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
