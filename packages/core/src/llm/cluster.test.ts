import { describe, expect, it } from "vitest";
import { asLabeledExamples, clusterByMerchant, type ClusterItem } from "./cluster";

const item = (over: Partial<ClusterItem> & Pick<ClusterItem, "id" | "counterparty">): ClusterItem => ({
  id: over.id,
  counterparty: over.counterparty,
  description: over.description ?? "",
  amountMinor: over.amountMinor ?? -500,
  currency: over.currency ?? "EUR",
  bookedAt: over.bookedAt ?? "2026-04-10T10:00:00Z",
  accountId: over.accountId ?? "acc-1",
  ...(over.categoryId !== undefined ? { categoryId: over.categoryId } : {}),
});

describe("clusterByMerchant", () => {
  it("groups by normalized counterparty", () => {
    const clusters = clusterByMerchant([
      item({ id: "a", counterparty: "SPAR 4411 Wien" }),
      item({ id: "b", counterparty: "SPAR 4411 Wien" }),
      item({ id: "c", counterparty: "Netflix Intl BV" }),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.members).toHaveLength(2);
  });

  it("collapses merchant IDs that only differ by digits", () => {
    const clusters = clusterByMerchant([
      item({ id: "a", counterparty: "BILLA 4411" }),
      item({ id: "b", counterparty: "BILLA 2201" }),
      item({ id: "c", counterparty: "BILLA 0807" }),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.members).toHaveLength(3);
  });

  it("ignores singletons", () => {
    const clusters = clusterByMerchant([
      item({ id: "a", counterparty: "One-off GmbH" }),
    ]);
    expect(clusters).toHaveLength(0);
  });
});

describe("asLabeledExamples", () => {
  it("only includes items with a categoryId", () => {
    const examples = asLabeledExamples([
      item({ id: "a", counterparty: "X", categoryId: "cat-1" }),
      item({ id: "b", counterparty: "X" }),
    ]);
    expect(examples).toHaveLength(1);
    expect(examples[0]!.categoryId).toBe("cat-1");
  });
});
