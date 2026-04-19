import { describe, expect, it } from "vitest";
import { evaluate, type CompiledRule } from "./engine";
import { validateRuleSpec } from "./spec";
import { proposeRule } from "./learn";

const tx = (over: Partial<Parameters<typeof evaluate>[0]> = {}) => ({
  bookedAt: "2026-04-17T10:00:00Z",
  amountMinor: -450,
  currency: "EUR",
  description: "CARD PAYMENT",
  counterparty: "SPAR Wien",
  accountId: "acc-1",
  ...over,
});

const rule = (id: string, spec: unknown, priority = 0): CompiledRule => ({
  id,
  enabled: true,
  priority,
  spec: validateRuleSpec(spec),
});

describe("rule engine", () => {
  it("matches on counterpartyContains case-insensitive", () => {
    const r = rule("r1", {
      match: { all: [{ kind: "counterpartyContains", value: "spar", caseInsensitive: true }] },
      action: { setCategoryId: "groceries" },
    });
    expect(evaluate(tx(), [r])?.action.setCategoryId).toBe("groceries");
  });

  it("respects priority", () => {
    const low = rule("low", {
      match: { all: [{ kind: "counterpartyContains", value: "SPAR", caseInsensitive: true }] },
      action: { setCategoryId: "groceries" },
    }, 0);
    const high = rule("high", {
      match: { all: [{ kind: "amountRange", sign: "debit", maxMinor: 1000 }] },
      action: { setCategoryId: "small-debits" },
    }, 10);
    expect(evaluate(tx(), [low, high])?.ruleId).toBe("high");
  });

  it("amountRange sign filters correctly", () => {
    const r = rule("r", {
      match: { all: [{ kind: "amountRange", sign: "credit", minMinor: 10000 }] },
      action: { setCategoryId: "salary" },
    });
    expect(evaluate(tx({ amountMinor: 250000 }), [r])).not.toBeNull();
    expect(evaluate(tx({ amountMinor: -250000 }), [r])).toBeNull();
  });

  it("any matcher succeeds if one condition holds", () => {
    const r = rule("r", {
      match: {
        any: [
          { kind: "counterpartyEquals", value: "Netflix" },
          { kind: "descriptionRegex", pattern: "NFLX", flags: "i" },
        ],
      },
      action: { setCategoryId: "subscriptions" },
    });
    expect(evaluate(tx({ counterparty: "Other", description: "NFLX BV" }), [r])).not.toBeNull();
  });
});

describe("rule learning", () => {
  it("proposes counterpartyEquals when all examples share counterparty", () => {
    const positives = [
      { ...tx(), counterparty: "Spotify AB", categoryId: "subs" },
      { ...tx(), counterparty: "Spotify AB", categoryId: "subs" },
    ];
    const spec = proposeRule(positives, []);
    expect(spec?.action.setCategoryId).toBe("subs");
    expect(spec?.match).toMatchObject({ all: [{ kind: "counterpartyEquals" }] });
  });

  it("rejects proposal that matches a negative example", () => {
    const positives = [
      { ...tx(), counterparty: "Amazon EU", categoryId: "shopping" },
      { ...tx(), counterparty: "Amazon EU", categoryId: "shopping" },
    ];
    const negatives = [
      { ...tx(), counterparty: "Amazon EU", categoryId: "aws-biz" },
    ];
    expect(proposeRule(positives, negatives)).toBeNull();
  });

  it("falls back to counterpartyContains on shared substring", () => {
    const positives = [
      { ...tx(), counterparty: "BILLA 4411 Wien", categoryId: "groceries" },
      { ...tx(), counterparty: "BILLA PLUS 2201", categoryId: "groceries" },
    ];
    const spec = proposeRule(positives, []);
    expect(spec?.match).toMatchObject({ all: [{ kind: "counterpartyContains" }] });
  });
});
