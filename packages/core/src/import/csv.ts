import type { NormalizedTransaction } from "../gocardless/normalize";

/**
 * Parse CSV text into a 2D array of strings. Handles:
 * - Quoted fields (enclosed in double quotes)
 * - Escaped quotes inside quoted fields (double double-quote: "")
 * - Embedded commas/newlines inside quoted fields
 * - CRLF or LF line endings
 * - Custom delimiter (default: comma)
 *
 * Pure, no external deps. Returns rows including the header row by default;
 * if `hasHeader` is true, the first row is dropped from the result.
 */
export function parseCsv(
  text: string,
  opts?: { delimiter?: string; hasHeader?: boolean },
): string[][] {
  const delimiter = opts?.delimiter ?? ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  // Strip UTF-8 BOM if present
  if (text.charCodeAt(0) === 0xfeff) {
    i = 1;
  }

  while (i < text.length) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    // Not in quotes
    if (ch === '"') {
      // Opening quote only meaningful at start of a field; treat stray as literal.
      if (field.length === 0) {
        inQuotes = true;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      // CRLF or lone CR ends the row
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      if (i + 1 < text.length && text[i + 1] === "\n") i += 2;
      else i++;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // Flush final field/row. Only push a trailing row if there is content
  // (avoid spurious empty row from a trailing newline).
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop wholly-empty rows (a single empty cell from blank lines)
  const cleaned = rows.filter((r) => !(r.length === 1 && r[0] === ""));

  if (opts?.hasHeader) return cleaned.slice(1);
  return cleaned;
}

export type CsvColumnMapping = {
  date: number;
  amount: number;
  currency?: number;
  counterparty?: number;
  description?: number;
  amountOutgoing?: number;
  amountIncoming?: number;
};

export type MapCsvOptions = {
  dateFormat?: "iso" | "dmy" | "mdy";
  defaultCurrency?: string;
};

export type MapCsvError = { row: number; reason: string };

export type MapCsvResult = {
  transactions: NormalizedTransaction[];
  errors: MapCsvError[];
};

/**
 * Convert previously-parsed CSV rows into NormalizedTransaction records.
 *
 * Amount parsing is resilient: accepts thousands separators (`,` or `.`),
 * either `.` or `,` as decimal separator, trailing currency sigils ($, €, £,
 * ...), whitespace, and negatives in either `-` or `(...)` form.
 *
 * If `amountOutgoing`/`amountIncoming` (two-column style) are both mapped,
 * the sign is derived: outgoing is negated, incoming is positive. The
 * single `amount` column is still required on the mapping (for type
 * simplicity it is ignored when two-column fields are both provided).
 *
 * Malformed rows are accumulated in `errors` and skipped rather than thrown.
 */
export function mapCsv(
  rows: string[][],
  mapping: CsvColumnMapping,
  opts?: MapCsvOptions,
): MapCsvResult {
  const transactions: NormalizedTransaction[] = [];
  const errors: MapCsvError[] = [];
  const dateFormat = opts?.dateFormat ?? "iso";
  const defaultCurrency = opts?.defaultCurrency ?? "EUR";
  const twoColumn =
    mapping.amountOutgoing !== undefined && mapping.amountIncoming !== undefined;

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;
    const rawDate = cell(row, mapping.date);
    if (!rawDate) {
      errors.push({ row: r, reason: "missing date" });
      continue;
    }
    const bookedAt = parseDate(rawDate, dateFormat);
    if (!bookedAt) {
      errors.push({ row: r, reason: `unparseable date: ${rawDate}` });
      continue;
    }

    let amountMinor: number | null = null;
    if (twoColumn) {
      const outRaw = cell(row, mapping.amountOutgoing!);
      const inRaw = cell(row, mapping.amountIncoming!);
      const outVal = outRaw ? parseAmount(outRaw) : null;
      const inVal = inRaw ? parseAmount(inRaw) : null;
      if (outVal !== null && outVal !== 0) {
        amountMinor = -Math.abs(outVal);
      } else if (inVal !== null && inVal !== 0) {
        amountMinor = Math.abs(inVal);
      } else {
        errors.push({ row: r, reason: "no amount in debit or credit column" });
        continue;
      }
    } else {
      const rawAmount = cell(row, mapping.amount);
      if (!rawAmount) {
        errors.push({ row: r, reason: "missing amount" });
        continue;
      }
      const parsed = parseAmount(rawAmount);
      if (parsed === null) {
        errors.push({ row: r, reason: `unparseable amount: ${rawAmount}` });
        continue;
      }
      amountMinor = parsed;
    }

    const currency =
      (mapping.currency !== undefined ? cell(row, mapping.currency) : "") ||
      defaultCurrency;
    const counterparty =
      mapping.counterparty !== undefined
        ? cell(row, mapping.counterparty) || undefined
        : undefined;
    const description =
      mapping.description !== undefined ? cell(row, mapping.description) : "";

    const externalId = synthCsvId(bookedAt, amountMinor, counterparty, description);

    transactions.push({
      externalId,
      bookedAt,
      amountMinor,
      currency,
      counterparty: counterparty?.trim(),
      description: description.trim(),
      rawPayloadJson: JSON.stringify({ source: "csv", row }),
    });
  }

  return { transactions, errors };
}

function cell(row: string[], idx: number): string {
  if (idx < 0 || idx >= row.length) return "";
  return (row[idx] ?? "").trim();
}

/**
 * Parse a numeric amount string into integer minor units.
 * Returns null on failure.
 */
export function parseAmount(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;

  // Parentheses denote negative (accounting convention).
  let neg = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    neg = true;
    s = s.slice(1, -1).trim();
  }

  // Leading or trailing sign.
  if (s.startsWith("-")) {
    neg = !neg;
    s = s.slice(1).trim();
  } else if (s.startsWith("+")) {
    s = s.slice(1).trim();
  }
  if (s.endsWith("-")) {
    neg = !neg;
    s = s.slice(0, -1).trim();
  }

  // Strip currency sigils and spaces. Keep digits, `,`, `.`.
  s = s.replace(/[^0-9.,]/g, "");
  if (!s) return null;

  // Determine decimal separator: whichever appears *last* is decimal;
  // the other is a thousands separator and gets stripped.
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let intPart = s;
  let fracPart = "";
  if (lastComma === -1 && lastDot === -1) {
    intPart = s;
  } else {
    const decIdx = Math.max(lastComma, lastDot);
    const decChar = s[decIdx];
    // A separator with >3 digits after it isn't decimal, it's thousands.
    const tail = s.slice(decIdx + 1);
    if (tail.length > 0 && tail.length <= 3 && /^\d+$/.test(tail) && tail.length !== 3) {
      intPart = s.slice(0, decIdx).replace(/[.,]/g, "");
      fracPart = tail;
    } else if (tail.length === 3 && /^\d+$/.test(tail)) {
      // Ambiguous (e.g., "1,234" or "1.234"). If there's an earlier separator
      // of the other kind, treat `decChar` as thousands; else treat as decimal
      // only when the other separator isn't present anywhere in the string.
      const otherChar = decChar === "," ? "." : ",";
      if (s.includes(otherChar)) {
        // e.g. "1.234,56" already handled (tail len 2); "1,234.56" handled;
        // "1.234,567" -> treat last as decimal (fall through).
        intPart = s.slice(0, decIdx).replace(/[.,]/g, "");
        fracPart = tail;
      } else {
        // Single separator, exactly 3 digits after: thousands.
        intPart = s.replace(/[.,]/g, "");
        fracPart = "";
      }
    } else {
      intPart = s.slice(0, decIdx).replace(/[.,]/g, "");
      fracPart = tail;
    }
  }

  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) return null;
  const intVal = intPart === "" ? 0 : Number.parseInt(intPart, 10);
  const fracNorm = (fracPart + "00").slice(0, 2);
  const fracVal = fracNorm === "" ? 0 : Number.parseInt(fracNorm, 10);
  if (Number.isNaN(intVal) || Number.isNaN(fracVal)) return null;
  const minor = intVal * 100 + fracVal;
  return neg ? -minor : minor;
}

/**
 * Normalize a date string per declared format to an ISO-8601 date (YYYY-MM-DD).
 * Returns null on failure.
 */
export function parseDate(
  raw: string,
  format: "iso" | "dmy" | "mdy",
): string | null {
  const s = raw.trim();
  if (!s) return null;

  if (format === "iso") {
    // Accept YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ style.
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    const [, y, mo, d] = m;
    if (!isValidYmd(+y!, +mo!, +d!)) return null;
    return `${y}-${mo}-${d}`;
  }

  // dmy / mdy: accept `/`, `-`, or `.` separators; years 2 or 4 digits.
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/);
  if (!m) return null;
  const a = Number.parseInt(m[1]!, 10);
  const b = Number.parseInt(m[2]!, 10);
  let y = Number.parseInt(m[3]!, 10);
  if (m[3]!.length === 2) y = y >= 70 ? 1900 + y : 2000 + y;

  let day: number;
  let mo: number;
  if (format === "dmy") {
    day = a;
    mo = b;
  } else {
    mo = a;
    day = b;
  }
  if (!isValidYmd(y, mo, day)) return null;
  return `${pad(y, 4)}-${pad(mo, 2)}-${pad(day, 2)}`;
}

function isValidYmd(y: number, m: number, d: number): boolean {
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/**
 * Generate a stable, low-collision external id for a CSV row. We use a simple
 * 32-bit rolling hash of the key fields; matches the `synth-` pattern from
 * the GoCardless normalizer but prefixed `csv-` so the source is obvious.
 */
export function synthCsvId(
  bookedAt: string,
  amountMinor: number,
  counterparty?: string,
  description?: string,
): string {
  const payload = `${bookedAt}|${amountMinor}|${counterparty ?? ""}|${description ?? ""}`;
  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    hash = (hash * 31 + payload.charCodeAt(i)) | 0;
  }
  return `csv-${Math.abs(hash).toString(36)}`;
}
