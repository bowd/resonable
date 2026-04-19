import { useMemo, useState } from "react";
import { Group } from "jazz-tools";
import { canRevokeLabel } from "@resonable/core";
import { useAccount } from "../jazz";
import { readAllLabels, revokeLabel, type LabelRow } from "../data/bindings";

export function ModerationView() {
  const { me } = useAccount();
  const firstHousehold = me?.profile?.households?.[0]?.household;
  const [filter, setFilter] = useState<string>("");
  const [showRevoked, setShowRevoked] = useState(false);

  const myRole = useMemo(() => {
    if (!firstHousehold) return undefined;
    const group = firstHousehold._owner.castAs(Group);
    const r = group.myRole();
    if (r === "reader" || r === "writer" || r === "admin") return r;
    return "reader";
  }, [firstHousehold]);

  const rows = useMemo(
    () => (firstHousehold ? readAllLabels(firstHousehold) : []),
    [
      firstHousehold,
      firstHousehold?.accounts?.flatMap((a) =>
        (a?.transactions ?? []).map((t) => t?.labels?.length ?? 0).join("."),
      ).join(","),
    ],
  );

  const authors = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.label.byAccountId);
    return [...set];
  }, [rows]);

  const filtered = rows.filter((r) => {
    if (!showRevoked && r.label.revoked) return false;
    if (filter && r.label.byAccountId !== filter) return false;
    return true;
  });

  if (!firstHousehold) {
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
        <LabelLine key={i} row={row} myRole={myRole} meAccountId={me?.id ?? ""} />
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
