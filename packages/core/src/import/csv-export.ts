/**
 * One row of the exported CSV. Field naming mirrors the NormalizedTransaction
 * concept but with display-side resolutions already applied (account, category,
 * and tag names instead of ids) so this module stays free of schema concerns.
 */
export type CsvExportRow = {
  bookedAt: string;
  amountMinor: number;
  currency: string;
  counterparty?: string;
  description: string;
  accountName?: string;
  categoryName?: string;
  tagNames?: string[];
};

const HEADER = [
  "date",
  "amount",
  "currency",
  "counterparty",
  "description",
  "account",
  "category",
  "tags",
] as const;

/**
 * Serialize rows to RFC-4180-ish CSV text.
 *
 * - Columns: date, amount, currency, counterparty, description, account,
 *   category, tags (in that order), with a header row.
 * - Fields containing `,`, `"`, or a line break are wrapped in double quotes;
 *   embedded `"` are doubled.
 * - Date is rendered as `YYYY-MM-DD` — we take the first 10 chars of the
 *   bookedAt string, which tolerates both date-only and ISO date-time inputs.
 * - Amount is a decimal with exactly 2 digits after the point; the sign is
 *   preserved in front (e.g. `-12.34`).
 * - Tag names are joined with `;`; the whole joined value is still put through
 *   the quoting rules if it contains special characters.
 *
 * Rows are separated with `\r\n` so Excel on Windows handles them cleanly.
 */
export function exportTransactionsCsv(rows: CsvExportRow[]): string {
  const lines: string[] = [];
  lines.push(HEADER.map(escapeCell).join(","));
  for (const r of rows) {
    const cells = [
      formatDate(r.bookedAt),
      formatAmount(r.amountMinor),
      r.currency,
      r.counterparty ?? "",
      r.description ?? "",
      r.accountName ?? "",
      r.categoryName ?? "",
      (r.tagNames ?? []).join(";"),
    ];
    lines.push(cells.map(escapeCell).join(","));
  }
  return lines.join("\r\n");
}

function escapeCell(value: string): string {
  if (value === "") return "";
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatDate(bookedAt: string): string {
  // Accepts either an ISO date-time or a plain YYYY-MM-DD; take the date part.
  return bookedAt.slice(0, 10);
}

function formatAmount(amountMinor: number): string {
  const neg = amountMinor < 0;
  const abs = Math.abs(amountMinor);
  const whole = Math.trunc(abs / 100);
  const frac = abs % 100;
  const fracStr = frac < 10 ? `0${frac}` : String(frac);
  return `${neg ? "-" : ""}${whole}.${fracStr}`;
}
