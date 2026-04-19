import { describe, expect, it } from "vitest";
import { summarize, type SummaryInput } from "./summary";

const t = (over: Partial<SummaryInput> & Pick<SummaryInput, "id">): SummaryInput => ({
  bookedAt: "2026-04-10T10:00:00Z",
  amountMinor: -500,
  currency: "EUR",
  counterparty: "SPAR Wien",
  accountId: "acc-1",
  ...over,
});

const range = { from: "2026-04-01T00:00:00Z", to: "2026-04-30T23:59:59Z" };

describe("summarize", () => {
  it("splits spend vs income and counts transactions", () => {
    const s = summarize([
      t({ id: "a", amountMinor: -1000 }),
      t({ id: "b", amountMinor: -500 }),
      t({ id: "c", amountMinor: 250000, counterparty: "ACME" }),
    ], range);
    expect(s.totalSpendMinor).toBe(1500);
    expect(s.totalIncomeMinor).toBe(250000);
    expect(s.transactionCount).toBe(3);
  });

  it("groups spend by category and tracks uncategorized", () => {
    const s = summarize([
      t({ id: "a", amountMinor: -400, categoryId: "groceries" }),
      t({ id: "b", amountMinor: -600, categoryId: "groceries" }),
      t({ id: "c", amountMinor: -200 }),
    ], range);
    const groceries = s.byCategory.find((c) => c.categoryId === "groceries");
    expect(groceries?.spendMinor).toBe(1000);
    expect(s.uncategorizedCount).toBe(1);
  });

  it("ranks top merchants by total spend", () => {
    const s = summarize([
      t({ id: "a", amountMinor: -1000, counterparty: "Netflix" }),
      t({ id: "b", amountMinor: -1000, counterparty: "Netflix" }),
      t({ id: "c", amountMinor: -300, counterparty: "Spotify" }),
    ], range);
    expect(s.topMerchants[0]?.counterparty).toBe("Netflix");
    expect(s.topMerchants[0]?.spendMinor).toBe(2000);
  });

  it("skips transactions in a different currency from the dominant one", () => {
    const s = summarize([
      t({ id: "a", currency: "EUR", amountMinor: -100 }),
      t({ id: "b", currency: "EUR", amountMinor: -200 }),
      t({ id: "c", currency: "USD", amountMinor: -1000 }),
    ], range);
    expect(s.currency).toBe("EUR");
    expect(s.totalSpendMinor).toBe(300);
  });

  it("excludes transactions outside the date range", () => {
    const s = summarize([
      t({ id: "a", bookedAt: "2026-04-10T00:00:00Z", amountMinor: -100 }),
      t({ id: "b", bookedAt: "2026-03-31T00:00:00Z", amountMinor: -100 }),
    ], range);
    expect(s.totalSpendMinor).toBe(100);
  });

  it("aggregates spend by tag with multi-tag transactions counting in each tag", () => {
    const s = summarize([
      t({ id: "a", amountMinor: -1000, tagIds: ["business", "travel"] }),
      t({ id: "b", amountMinor: -400, tagIds: ["business"] }),
      t({ id: "c", amountMinor: -200, tagIds: ["travel"] }),
      t({ id: "d", amountMinor: -50 }),
      t({ id: "e", amountMinor: 5000, tagIds: ["business"] }),
    ], range);
    const business = s.byTag.find((x) => x.tagId === "business");
    const travel = s.byTag.find((x) => x.tagId === "travel");
    expect(business?.spendMinor).toBe(1400);
    expect(business?.count).toBe(3);
    expect(travel?.spendMinor).toBe(1200);
    expect(travel?.count).toBe(2);
    expect(s.byTag[0]?.tagId).toBe("business");
    expect(s.byTag[1]?.tagId).toBe("travel");
  });
});
