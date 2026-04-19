import { useState } from "react";
import { Group } from "jazz-tools";
import { Account, Connection, TransactionList } from "@resonable/schema";
import { useAccount } from "../jazz";
import { platform } from "../platform";

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
        <AccountCard key={i} account={acc} />
      ) : null)}
      <LinkBankForm householdId={firstHousehold.id} />
    </>
  );
}

function AccountCard({ account }: { account: Account }) {
  return (
    <div className="card">
      <div className="row">
        <div>
          <strong>{account.name}</strong>
          <span className="pill">{account.currency}</span>
          <div className="muted">{account.institutionName} \u2022 {account.iban ?? "\u2014"}</div>
        </div>
        <div className="muted">
          {account.transactions?.length ?? 0} tx
        </div>
      </div>
    </div>
  );
}

function LinkBankForm({ householdId }: { householdId: string }) {
  const { me } = useAccount();
  const [country, setCountry] = useState("AT");
  const [status, setStatus] = useState<string | null>(null);

  async function startLink() {
    if (!platform.isNative) {
      setStatus(
        "Bank linking requires the desktop build or a self-hosted broker (set resonable.broker.url in local storage).",
      );
      return;
    }
    setStatus("Fetching institutions\u2026");
    try {
      const connectionId = `${householdId}:${me?.id ?? "unknown"}`;
      const list = await platform.bankData.listInstitutions(connectionId, country);
      const bank = list.find((i) => /revolut|n26/i.test(i.name)) ?? list[0];
      if (!bank) return setStatus("No institutions found for country.");
      const req = await platform.bankData.createRequisition(connectionId, {
        institutionId: bank.id,
        redirectUrl: "resonable://oauth/callback",
        reference: connectionId,
      });
      setStatus(`Open this URL to consent: ${req.link}`);
    } catch (err) {
      setStatus(`Error: ${(err as Error).message}`);
    }
  }

  // Placeholder: the Group wiring for a newly-linked bank account happens
  // after the consent redirect returns, where we poll requisition status,
  // fetch account details, and create the Account CoValue under the household
  // Group. Left as a TODO \u2014 the data model is already in place.
  void Account; void Connection; void TransactionList; void Group;

  return (
    <div className="card">
      <label>Country</label>
      <input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))} />
      <div style={{ marginTop: 8 }}>
        <button className="primary" onClick={startLink}>Link Revolut / N26</button>
      </div>
      {status && <p className="muted" style={{ marginTop: 8 }}>{status}</p>}
    </div>
  );
}
