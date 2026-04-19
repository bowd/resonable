import { describe, expect, it } from "vitest";
import { parseCsv, mapCsv, parseAmount, parseDate } from "./csv";

describe("parseCsv", () => {
  it("parses quoted fields with embedded commas", () => {
    const input = 'date,counterparty,amount\n2026-04-15,"SPAR, Wien","-12.34"';
    const rows = parseCsv(input);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual(["2026-04-15", "SPAR, Wien", "-12.34"]);
  });

  it("parses quoted fields with escaped double-quotes", () => {
    const input = 'a,b\n"She said ""hi""","2"';
    const rows = parseCsv(input);
    expect(rows[1]).toEqual(['She said "hi"', "2"]);
  });

  it("handles CRLF line endings", () => {
    const input = "a,b\r\n1,2\r\n3,4\r\n";
    const rows = parseCsv(input);
    expect(rows).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("drops header when hasHeader is true", () => {
    const rows = parseCsv("a,b\n1,2", { hasHeader: true });
    expect(rows).toEqual([["1", "2"]]);
  });

  it("supports a custom delimiter", () => {
    const rows = parseCsv("a;b\n1;2", { delimiter: ";" });
    expect(rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("parseAmount", () => {
  it("handles plain decimals", () => {
    expect(parseAmount("12.34")).toBe(1234);
    expect(parseAmount("-12.34")).toBe(-1234);
  });

  it("handles parenthesised negatives", () => {
    expect(parseAmount("(42.00)")).toBe(-4200);
  });

  it("handles comma decimal + dot thousands", () => {
    expect(parseAmount("1.234,56")).toBe(123456);
  });

  it("handles dot decimal + comma thousands", () => {
    expect(parseAmount("1,234.56")).toBe(123456);
  });

  it("strips currency sigils", () => {
    expect(parseAmount("€12.34")).toBe(1234);
    expect(parseAmount("$1,234.56")).toBe(123456);
    expect(parseAmount("12.34 EUR")).toBe(1234);
  });

  it("treats single 3-digit group as thousands", () => {
    expect(parseAmount("1,234")).toBe(123400);
  });
});

describe("parseDate", () => {
  it("parses iso YYYY-MM-DD", () => {
    expect(parseDate("2026-04-15", "iso")).toBe("2026-04-15");
  });

  it("parses iso datetime", () => {
    expect(parseDate("2026-04-15T10:20:30Z", "iso")).toBe("2026-04-15");
  });

  it("parses dmy with slashes", () => {
    expect(parseDate("15/04/2026", "dmy")).toBe("2026-04-15");
  });

  it("parses mdy with slashes", () => {
    expect(parseDate("04/15/2026", "mdy")).toBe("2026-04-15");
  });

  it("rejects invalid calendar dates", () => {
    expect(parseDate("2026-02-30", "iso")).toBeNull();
    expect(parseDate("31/02/2026", "dmy")).toBeNull();
  });
});

describe("mapCsv", () => {
  it("maps a single-amount row with ISO date", () => {
    const rows = [["2026-04-15", "-12.34", "SPAR", "CARD PAYMENT"]];
    const { transactions, errors } = mapCsv(
      rows,
      { date: 0, amount: 1, counterparty: 2, description: 3 },
      { dateFormat: "iso" },
    );
    expect(errors).toEqual([]);
    expect(transactions).toHaveLength(1);
    const t = transactions[0]!;
    expect(t.bookedAt).toBe("2026-04-15");
    expect(t.amountMinor).toBe(-1234);
    expect(t.counterparty).toBe("SPAR");
    expect(t.description).toBe("CARD PAYMENT");
    expect(t.currency).toBe("EUR");
    expect(t.externalId).toMatch(/^csv-/);
  });

  it("derives sign from two-column debit/credit style", () => {
    const rows = [
      ["2026-04-15", "12.34", "", "SPAR", "DEBIT"],
      ["2026-04-16", "", "2500.00", "ACME", "SALARY"],
    ];
    const { transactions, errors } = mapCsv(rows, {
      date: 0,
      amount: 1, // ignored when two-column present, but required by type
      amountOutgoing: 1,
      amountIncoming: 2,
      counterparty: 3,
      description: 4,
    });
    expect(errors).toEqual([]);
    expect(transactions.map((t) => t.amountMinor)).toEqual([-1234, 250000]);
  });

  it("parses dmy dates", () => {
    const rows = [["15/04/2026", "-10.00"]];
    const { transactions, errors } = mapCsv(
      rows,
      { date: 0, amount: 1 },
      { dateFormat: "dmy" },
    );
    expect(errors).toEqual([]);
    expect(transactions[0]?.bookedAt).toBe("2026-04-15");
  });

  it("parses mdy dates", () => {
    const rows = [["04/15/2026", "-10.00"]];
    const { transactions, errors } = mapCsv(
      rows,
      { date: 0, amount: 1 },
      { dateFormat: "mdy" },
    );
    expect(errors).toEqual([]);
    expect(transactions[0]?.bookedAt).toBe("2026-04-15");
  });

  it("reports missing-date rows as errors without throwing", () => {
    const rows = [
      ["", "-10.00"],
      ["2026-04-15", "-5.00"],
    ];
    const { transactions, errors } = mapCsv(rows, { date: 0, amount: 1 });
    expect(errors).toEqual([{ row: 0, reason: "missing date" }]);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]?.bookedAt).toBe("2026-04-15");
  });

  it("honours a defaultCurrency override", () => {
    const rows = [["2026-04-15", "-10.00"]];
    const { transactions } = mapCsv(
      rows,
      { date: 0, amount: 1 },
      { defaultCurrency: "USD" },
    );
    expect(transactions[0]?.currency).toBe("USD");
  });
});
