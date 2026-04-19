import { useMemo, useState } from "react";
import { canRevokeLabel } from "@resonable/core";
import { useCurrentAccount, useFirstHousehold } from "../jazz";
import { readAllLabels, revokeLabel, type LabelRow } from "../data/bindings";

export function ModerationView() {
  const me = useCurrentAccount();
  const { household } = useFirstHousehold();
  const [filter, setFilter] = useState<string>("");
  const [showRevoked, setShowRevoked] = useState(false);

  const myRole = useMemo(() => {
    if (!household) return undefined;
    const r = household.$jazz.owner.myRole();
    if (r === "reader" || r === "writer" || r === "admin") return r;
    return "reader";
  }, [household]);

  const rows = useMemo(
    () => (household ? readAllLabels(household) : []),
    [household],
  );

  const authorStats = useMemo(() => {
    const map = new Map<string, { total: number; revoked: number; bySource: Record<string, number> }>();
    for (const r of rows) {
      const m = map.get(r.label.byAccountId) ?? { total: 0, revoked: 0, bySource: {} };
      m.total++;
      if (r.label.revoked) m.revoked++;
      m.bySource[r.label.source] = (m.bySource[r.label.source] ?? 0) + 1;
      map.set(r.label.byAccountId, m);
    }
    return [...map.entries()]
      .map(([accountId, stats]) => ({ accountId, ...stats }))
      .sort((a, b) => b.total - a.total);
  }, [rows]);

  const authors = authorStats.map((a) => a.accountId);

  const filtered = rows.filter((r) => {
    if (!showRevoked && r.label.revoked) return false;
    if (filter && r.label.byAccountId !== filter) return false;
    return true;
  });

  if (!household) {
    return (
      <>
        <h2>Moderation</h2>
        <p className="muted">No household yet.</p>
      </>
    );
  }

  return (
    <>
      <h2>Moderation</h2>
      <p className="muted">
        Every label is an append-only overlay attributed to a member.
        Admins can revoke any label; non-admins can only revoke their own.
      </p>
      {authorStats.length > 0 && (
        <div className="card">
          <strong>Activity by member</strong>
          <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
            {authorStats.map((a) => {
              const sources = Object.entries(a.bySource)
                .sort((x, y) => y[1] - x[1])
                .map(([s, n]) => `${s}:${n}`)
                .join(" \u00b7 ");
              return (
                <div key={a.accountId} className="row" style={{ padding: "4px 0" }}>
                  <div>
                    <strong>{shortId(a.accountId)}</strong>
                    <span className="muted" style={{ marginLeft: 6 }}>{sources}</span>
                  </div>
                  <div className="muted">
                    {a.total} label{a.total === 1 ? "" : "s"}
                    {a.revoked > 0 && ` \u2022 ${a.revoked} revoked`}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="card">
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ margin: 0 }}>Author</label>
          <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: "auto" }}>
            <option value="">(all)</option>
            {authors.map((a) => <option key={a} value={a}>{shortId(a)}</option>)}
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: 4, margin: 0 }}>
            <input type="checkbox" checked={showRevoked} onChange={(e) => setShowRevoked(e.target.checked)} style={{ width: "auto" }} />
            <span>show revoked</span>
          </label>
          <span className="muted" style={{ marginLeft: "auto" }}>
            you are {myRole ?? "\u2014"} \u2022 {filtered.length} of {rows.length} shown
          </span>
        </div>
      </div>
      {filtered.length === 0 && <p className="muted">No labels match.</p>}
      {filtered.slice(0, 200).map((row, i) => (
        <LabelLine key={i} row={row} myRole={myRole} meAccountId={me.$isLoaded ? me.$jazz.id : ""} />
      ))}
    </>
  );
}

function LabelLine({
  row, myRole, meAccountId,
}: { row: LabelRow; myRole?: "reader" | "writer" | "admin"; meAccountId: string }) {
  const isAuthor = row.label.byAccountId === meAccountId;
  const canRevoke = myRole ? canRevokeLabel(myRole, isAuthor) : false;

  return (
    <div className="row">
      <div style={{ flex: 1 }}>
        <div>
          <strong>{row.transaction.counterparty ?? "\u2014"}</strong>
          <span className="muted" style={{ marginLeft: 8 }}>
            {row.transaction.description.slice(0, 60)}
          </span>
          <span className="pill">{row.categoryName ?? "\u2014"}</span>
          <span className="pill">{row.label.source}</span>
          {row.label.revoked && <span className="pill">revoked</span>}
        </div>
        <div className="muted">
          {new Date(row.label.at).toLocaleString()} by {shortId(row.label.byAccountId)}
          \u2002\u2022\u2002 {row.account.name}
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div>{(row.transaction.amountMinor / 100).toFixed(2)} {row.transaction.currency}</div>
        {!row.label.revoked && canRevoke && (
          <button onClick={() => revokeLabel(row.label)} style={{ marginTop: 4, fontSize: 12 }}>
            Revoke
          </button>
        )}
      </div>
    </div>
  );
}

function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 4)}\u2026${id.slice(-4)}` : id;
}
