import { useMemo, useRef, useState } from "react";
import type { LoadedAccount, LoadedHousehold } from "@resonable/schema";
import {
  mapCsv,
  parseCsv,
  type CsvColumnMapping,
  type NormalizedTransaction,
} from "@resonable/core";
import { useFirstHousehold } from "../jazz";
import { importCsvToAccount } from "../data/import";

type DateFormat = "iso" | "dmy" | "mdy";

// A column's role inside the CSV. Mirrors CsvColumnMapping's optional slots.
type Role =
  | "ignore"
  | "date"
  | "amount"
  | "amountOutgoing"
  | "amountIncoming"
  | "currency"
  | "counterparty"
  | "description";

const ROLE_LABELS: Record<Role, string> = {
  ignore: "(ignore)",
  date: "Date",
  amount: "Amount (signed)",
  amountOutgoing: "Debit / outgoing",
  amountIncoming: "Credit / incoming",
  currency: "Currency",
  counterparty: "Counterparty",
  description: "Description",
};

const ROLE_ORDER: Role[] = [
  "ignore",
  "date",
  "amount",
  "amountOutgoing",
  "amountIncoming",
  "currency",
  "counterparty",
  "description",
];

export function ImportView() {
  const { household } = useFirstHousehold();

  if (!household) {
    return (
      <>
        <h2>Import CSV</h2>
        <p className="muted">Create a household first.</p>
      </>
    );
  }

  const accounts: LoadedAccount[] = [];
  for (const a of household.accounts as unknown as ReadonlyArray<LoadedAccount>) {
    if (a && !a.archived) accounts.push(a);
  }

  if (accounts.length === 0) {
    return (
      <>
        <h2>Import CSV</h2>
        <p className="muted">
          You need at least one account to import transactions. Create one on
          the Accounts tab first.
        </p>
      </>
    );
  }

  return (
    <>
      <h2>Import CSV</h2>
      <p className="muted">
        Paste or upload a CSV exported from a bank that isn&apos;t supported by
        GoCardless. Parsing happens entirely in this tab \u2014 nothing is uploaded.
      </p>
      <ImportFlow household={household} accounts={accounts} />
    </>
  );
}

function ImportFlow(props: { household: LoadedHousehold; accounts: LoadedAccount[] }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [rows, setRows] = useState<string[][] | null>(null);
  const [hasHeader, setHasHeader] = useState(true);
  const [delimiter, setDelimiter] = useState(",");
  const [dateFormat, setDateFormat] = useState<DateFormat>("iso");
  const [defaultCurrency, setDefaultCurrency] = useState("EUR");
  const [roles, setRoles] = useState<Role[]>([]);
  const [targetAccountId, setTargetAccountId] = useState<string>(props.accounts[0]!.$jazz.id);
  const [result, setResult] = useState<null | {
    before: number;
    after: number;
    added: number;
    skipped: number;
    errors: { row: number; reason: string }[];
  }>(null);
  const [importing, setImporting] = useState(false);
  const [importErr, setImportErr] = useState<string | null>(null);

  function onParse() {
    setResult(null);
    setImportErr(null);
    const parsed = parseCsv(text, { delimiter, hasHeader: false });
    if (parsed.length === 0) {
      setRows(null);
      return;
    }
    setRows(parsed);
    // Guess roles from the (possibly present) header line.
    const width = parsed[0]!.length;
    const header = hasHeader ? parsed[0]! : parsed[0]!.map((_, i) => `col ${i + 1}`);
    setRoles(guessRoles(header, width));
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const contents = await file.text();
    setText(contents);
  }

  // Build a CsvColumnMapping from per-column role picks.
  const mapping = useMemo<CsvColumnMapping | null>(() => {
    if (!rows) return null;
    const byRole = new Map<Role, number>();
    for (let i = 0; i < roles.length; i++) {
      const r = roles[i]!;
      if (r === "ignore") continue;
      if (!byRole.has(r)) byRole.set(r, i);
    }
    const date = byRole.get("date");
    const amount = byRole.get("amount");
    const amountOutgoing = byRole.get("amountOutgoing");
    const amountIncoming = byRole.get("amountIncoming");
    if (date === undefined) return null;
    const hasTwoColumn =
      amountOutgoing !== undefined && amountIncoming !== undefined;
    if (amount === undefined && !hasTwoColumn) return null;
    return {
      date,
      // The mapping type requires `amount`; if only two-column columns are
      // picked, fall back to the outgoing column index (mapCsv ignores it
      // when both two-column fields are set).
      amount: amount ?? amountOutgoing ?? date,
      currency: byRole.get("currency"),
      counterparty: byRole.get("counterparty"),
      description: byRole.get("description"),
      amountOutgoing,
      amountIncoming,
    };
  }, [rows, roles]);

  const dataRows = useMemo(() => {
    if (!rows) return [];
    return hasHeader ? rows.slice(1) : rows;
  }, [rows, hasHeader]);

  const mapResult = useMemo(() => {
    if (!mapping || dataRows.length === 0) return null;
    return mapCsv(dataRows, mapping, { dateFormat, defaultCurrency });
  }, [mapping, dataRows, dateFormat, defaultCurrency]);

  async function onImport() {
    if (!mapResult || !mapping) return;
    const account = props.accounts.find((a) => a.$jazz.id === targetAccountId);
    if (!account) return;
    setImporting(true);
    setImportErr(null);
    try {
      const before = account.transactions.length;
      const group = props.household.$jazz.owner;
      const { added, skipped } = importCsvToAccount(
        account,
        mapResult.transactions,
        group,
      );
      const after = account.transactions.length;
      setResult({
        before,
        after,
        added: added.length,
        skipped,
        errors: mapResult.errors,
      });
    } catch (err) {
      setImportErr((err as Error).message);
    } finally {
      setImporting(false);
    }
  }

  const headerRow = rows && hasHeader ? rows[0] : null;

  return (
    <>
      <div className="card">
        <strong>Step 1 \u2014 paste CSV or upload a file</strong>
        <label style={{ marginTop: 8 }}>Paste CSV</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="date,amount,counterparty,description\n2026-04-15,-12.34,SPAR,CARD PAYMENT"
          rows={8}
          style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" onChange={onFile} />
          <label style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
            <span>Delimiter</span>
            <input
              value={delimiter}
              onChange={(e) => setDelimiter(e.target.value.slice(0, 1) || ",")}
              style={{ width: 40 }}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
            <input
              type="checkbox"
              checked={hasHeader}
              onChange={(e) => setHasHeader(e.target.checked)}
              style={{ width: "auto" }}
            />
            <span>First row is header</span>
          </label>
          <button className="primary" disabled={!text.trim()} onClick={onParse}>
            Parse
          </button>
        </div>
      </div>

      {rows && (
        <div className="card">
          <strong>Step 2 \u2014 map columns</strong>
          <div className="muted" style={{ marginBottom: 8 }}>
            {rows.length} row{rows.length === 1 ? "" : "s"} detected
            ({dataRows.length} data row{dataRows.length === 1 ? "" : "s"}).
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>
                  {(headerRow ?? rows[0]!).map((h, i) => (
                    <th key={i} style={{ textAlign: "left", padding: 4, borderBottom: "1px solid var(--border)" }}>
                      {headerRow ? h : `col ${i + 1}`}
                    </th>
                  ))}
                </tr>
                <tr>
                  {rows[0]!.map((_, i) => (
                    <th key={i} style={{ padding: 4 }}>
                      <select
                        value={roles[i] ?? "ignore"}
                        onChange={(e) => {
                          const next = roles.slice();
                          next[i] = e.target.value as Role;
                          setRoles(next);
                        }}
                      >
                        {ROLE_ORDER.map((r) => (
                          <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                        ))}
                      </select>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dataRows.slice(0, 5).map((r, ri) => (
                  <tr key={ri}>
                    {r.map((c, ci) => (
                      <td key={ci} style={{ padding: 4, borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
              <span>Date format</span>
              <select value={dateFormat} onChange={(e) => setDateFormat(e.target.value as DateFormat)}>
                <option value="iso">ISO (YYYY-MM-DD)</option>
                <option value="dmy">DMY (15/04/2026)</option>
                <option value="mdy">MDY (04/15/2026)</option>
              </select>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
              <span>Default currency</span>
              <input
                value={defaultCurrency}
                onChange={(e) => setDefaultCurrency(e.target.value.toUpperCase().slice(0, 3))}
                style={{ width: 60 }}
              />
            </label>
          </div>
        </div>
      )}

      {mapping && mapResult && (
        <div className="card">
          <strong>Preview (first 5 mapped rows)</strong>
          <div style={{ overflowX: "auto", marginTop: 8 }}>
            <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: 4, borderBottom: "1px solid var(--border)" }}>Date</th>
                  <th style={{ textAlign: "right", padding: 4, borderBottom: "1px solid var(--border)" }}>Amount</th>
                  <th style={{ textAlign: "left", padding: 4, borderBottom: "1px solid var(--border)" }}>Ccy</th>
                  <th style={{ textAlign: "left", padding: 4, borderBottom: "1px solid var(--border)" }}>Counterparty</th>
                  <th style={{ textAlign: "left", padding: 4, borderBottom: "1px solid var(--border)" }}>Description</th>
                </tr>
              </thead>
              <tbody>
                {mapResult.transactions.slice(0, 5).map((t: NormalizedTransaction, i) => (
                  <tr key={i}>
                    <td style={{ padding: 4 }}>{t.bookedAt}</td>
                    <td style={{ padding: 4, textAlign: "right", fontFamily: "monospace" }}>
                      {(t.amountMinor / 100).toFixed(2)}
                    </td>
                    <td style={{ padding: 4 }}>{t.currency}</td>
                    <td style={{ padding: 4 }}>{t.counterparty ?? ""}</td>
                    <td style={{ padding: 4 }}>{t.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="muted" style={{ marginTop: 8 }}>
            {mapResult.transactions.length} parseable row{mapResult.transactions.length === 1 ? "" : "s"},
            {" "}
            {mapResult.errors.length} error{mapResult.errors.length === 1 ? "" : "s"}
          </div>
          {mapResult.errors.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary className="muted">Show parser errors</summary>
              <ul style={{ fontSize: 12, marginTop: 4 }}>
                {mapResult.errors.slice(0, 50).map((e, i) => (
                  <li key={i}>row {e.row + 1}: {e.reason}</li>
                ))}
              </ul>
            </details>
          )}

          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
              <span>Target account</span>
              <select
                value={targetAccountId}
                onChange={(e) => setTargetAccountId(e.target.value)}
              >
                {props.accounts.map((a) => (
                  <option key={a.$jazz.id} value={a.$jazz.id}>
                    {a.name} ({a.institutionName})
                  </option>
                ))}
              </select>
            </label>
            <button
              className="primary"
              disabled={importing || mapResult.transactions.length === 0}
              onClick={onImport}
            >
              {importing ? "Importing\u2026" : "Import to account"}
            </button>
          </div>
          {importErr && <div className="muted" style={{ marginTop: 8 }}>Error: {importErr}</div>}
        </div>
      )}

      {result && (
        <div className="card">
          <strong>Import complete</strong>
          <div style={{ marginTop: 4 }}>
            Transactions: {result.before} \u2192 {result.after}
          </div>
          <div className="muted">
            Added {result.added}, skipped {result.skipped} already-present by
            external id, {result.errors.length} parser errors.
          </div>
        </div>
      )}
    </>
  );
}

function guessRoles(header: string[], width: number): Role[] {
  const roles: Role[] = new Array(width).fill("ignore");
  for (let i = 0; i < width; i++) {
    const h = (header[i] ?? "").toLowerCase();
    if (!h) continue;
    if (/^(date|booking.?date|transaction.?date|value.?date)$/.test(h)) roles[i] = "date";
    else if (/^(amount|value|sum)$/.test(h)) roles[i] = "amount";
    else if (/debit|outgoing|withdrawal/.test(h)) roles[i] = "amountOutgoing";
    else if (/credit|incoming|deposit/.test(h)) roles[i] = "amountIncoming";
    else if (/^(currency|ccy)$/.test(h)) roles[i] = "currency";
    else if (/counterparty|payee|merchant|name/.test(h)) roles[i] = "counterparty";
    else if (/description|reference|memo|details/.test(h)) roles[i] = "description";
  }
  return roles;
}
