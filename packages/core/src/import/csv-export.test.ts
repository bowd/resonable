import { describe, expect, it } from "vitest";
import { exportTransactionsCsv, type CsvExportRow } from "./csv-export";

const base = (over: Partial<CsvExportRow> = {}): CsvExportRow => ({
  bookedAt: "2026-04-10",
  amountMinor: -1234,
  currency: "EUR",
  counterparty: "SPAR",
  description: "Groceries",
  accountName: "Main",
  categoryName: "Food",
  tagNames: ["weekly"],
  ...over,
});

describe("exportTransactionsCsv", () => {
  it("emits header + a basic row with the expected columns", () => {
    const csv = exportTransactionsCsv([base()]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe(
      "date,amount,currency,counterparty,description,account,category,tags",
    );
    expect(lines[1]).toBe("2026-04-10,-12.34,EUR,SPAR,Groceries,Main,Food,weekly");
  });

  it("formats positive amounts without a sign and pads the fraction", () => {
    const csv = exportTransactionsCsv([
      base({ amountMinor: 100, counterparty: "ACME", description: "refund", tagNames: [] }),
    ]);
    const lines = csv.split("\r\n");
    expect(lines[1]).toBe("2026-04-10,1.00,EUR,ACME,refund,Main,Food,");
  });

  it("truncates ISO datetimes to the date portion", () => {
    const csv = exportTransactionsCsv([
      base({ bookedAt: "2026-04-10T23:59:59Z", tagNames: [] }),
    ]);
    const lines = csv.split("\r\n");
    expect(lines[1]!.startsWith("2026-04-10,")).toBe(true);
  });

  it("quotes fields containing commas", () => {
    const csv = exportTransactionsCsv([
      base({ description: "Coffee, tea, and sundries", tagNames: [] }),
    ]);
    const lines = csv.split("\r\n");
    expect(lines[1]).toContain('"Coffee, tea, and sundries"');
  });

  it("escapes embedded double quotes by doubling them", () => {
    const csv = exportTransactionsCsv([
      base({ counterparty: 'The "Best" Cafe', tagNames: [] }),
    ]);
    const lines = csv.split("\r\n");
    expect(lines[1]).toContain('"The ""Best"" Cafe"');
  });

  it("quotes fields containing newlines", () => {
    const csv = exportTransactionsCsv([
      base({ description: "line1\nline2", tagNames: [] }),
    ]);
    const lines = csv.split("\r\n");
    // The newline lives inside a quoted cell, so the logical row is split by
    // our split("\r\n") call. The first segment should open the quote.
    expect(lines[1]).toContain('"line1');
  });

  it("joins tag names with `;` and quotes them only if needed", () => {
    const csv = exportTransactionsCsv([base({ tagNames: ["business", "travel"] })]);
    const lines = csv.split("\r\n");
    expect(lines[1]!.endsWith(",business;travel")).toBe(true);
  });

  it("handles missing counterparty, description, account, category, and tags", () => {
    const csv = exportTransactionsCsv([
      {
        bookedAt: "2026-04-10",
        amountMinor: 0,
        currency: "EUR",
        description: "",
      },
    ]);
    const lines = csv.split("\r\n");
    expect(lines[1]).toBe("2026-04-10,0.00,EUR,,,,,");
  });

  it("returns just the header when no rows are given", () => {
    const csv = exportTransactionsCsv([]);
    expect(csv).toBe(
      "date,amount,currency,counterparty,description,account,category,tags",
    );
  });
});
