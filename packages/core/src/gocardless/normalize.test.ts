import { describe, expect, it } from "vitest";
import { normalize } from "./normalize";

describe("normalize", () => {
  it("converts debit amount to negative minor units", () => {
    const n = normalize({
      transactionId: "tx-1",
      bookingDate: "2026-04-14",
      transactionAmount: { amount: "-12.34", currency: "EUR" },
      creditorName: "SPAR Wien",
      remittanceInformationUnstructured: "CARD PAYMENT",
    });
    expect(n.amountMinor).toBe(-1234);
    expect(n.counterparty).toBe("SPAR Wien");
    expect(n.currency).toBe("EUR");
  });

  it("handles credits and picks debtor as counterparty", () => {
    const n = normalize({
      transactionId: "tx-2",
      bookingDate: "2026-04-01",
      transactionAmount: { amount: "2500.00", currency: "EUR" },
      debtorName: "ACME GmbH",
      remittanceInformationUnstructured: "Salary",
    });
    expect(n.amountMinor).toBe(250000);
    expect(n.counterparty).toBe("ACME GmbH");
  });

  it("synthesises id when none present", () => {
    const n = normalize({
      bookingDate: "2026-04-10",
      transactionAmount: { amount: "-1.00", currency: "EUR" },
      creditorName: "x",
      remittanceInformationUnstructured: "y",
    });
    expect(n.externalId).toMatch(/^synth-/);
  });
});
