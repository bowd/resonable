import { useState } from "react";
import { Group } from "jazz-tools";
import { Account, Household } from "@resonable/schema";
import { useAccount } from "../jazz";
import { fixtureBank, platform } from "../platform";
import { importAccountForConnection, syncAccount } from "../data/import";

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
  const demo = fixtureBank();

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
      if (!demo) {
        setStatus(`Open ${req.link} in a browser to consent, then click Finish below.`);
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
        institutionName: which.startsWith("REVOLUT") ? "Revolut" : "N26",
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
    </div>
  );
}
