import { describe, expect, it, vi } from "vitest";
import { runPipeline, type PipelineTransaction } from "./pipeline";
import { validateRuleSpec } from "../rules/spec";
import { suggestRules } from "./suggest-rules";
import { defaultPolicy } from "../sync/moderation";
import type { LLMClient } from "../llm/client";

const tx = (id: string, over: Partial<PipelineTransaction> = {}): PipelineTransaction => ({
  id,
  bookedAt: "2026-04-10T10:00:00Z",
  amountMinor: -500,
  currency: "EUR",
  description: "CARD PAYMENT",
  counterparty: "SPAR Wien",
  accountId: "acc-1",
  ...over,
});

const compiled = (id: string, spec: unknown, priority = 0) => ({
  id,
  priority,
  enabled: true,
  spec: validateRuleSpec(spec),
});

describe("runPipeline", () => {
  const groceryRule = compiled("rule-groceries", {
    match: { all: [{ kind: "counterpartyContains", value: "SPAR", caseInsensitive: true }] },
    action: { setCategoryId: "groceries" },
  });

  it("applies rules deterministically and counts hits", async () => {
    const res = await runPipeline([tx("a"), tx("b"), tx("c", { counterparty: "Netflix" })], {
      rules: [groceryRule],
      categories: [],
      policy: defaultPolicy,
    });
    expect(res.labels).toHaveLength(2);
    expect(res.ruleHits.get("rule-groceries")).toBe(2);
    expect(res.suggestions).toHaveLength(0);
  });

  it("falls through to LLM for unmatched and emits suggestions by default", async () => {
    const llm: LLMClient = {
      name: "mock",
      defaultModel: "mock-1",
      complete: vi.fn().mockResolvedValue({
        content: JSON.stringify({ categoryId: "subscriptions", tags: ["streaming"], confidence: 0.7, reasoning: "looks like netflix" }),
        model: "mock-1",
      }),
    };
    const res = await runPipeline([tx("a"), tx("b", { counterparty: "Netflix", description: "NFLX" })], {
      rules: [groceryRule],
      categories: [{ id: "subscriptions", name: "Subscriptions" }, { id: "groceries", name: "Groceries" }],
      policy: defaultPolicy,
      llm,
    });
    expect(res.labels).toHaveLength(1);
    expect(res.suggestions).toHaveLength(1);
    expect(res.suggestions[0]).toMatchObject({ transactionId: "b", categoryId: "subscriptions" });
  });

  it("auto-applies LLM labels above threshold when policy allows", async () => {
    const llm: LLMClient = {
      name: "mock",
      defaultModel: "mock-1",
      complete: vi.fn().mockResolvedValue({
        content: JSON.stringify({ categoryId: "subscriptions", tags: [], confidence: 0.95, reasoning: "" }),
        model: "mock-1",
      }),
    };
    const res = await runPipeline([tx("b", { counterparty: "Netflix" })], {
      rules: [],
      categories: [{ id: "subscriptions", name: "Subscriptions" }],
      policy: { ...defaultPolicy, allowLLMAutoApply: true, autoApplyMinConfidence: 0.9 },
      llm,
    });
    expect(res.labels).toHaveLength(1);
    expect(res.labels[0]).toMatchObject({ source: "llm", categoryId: "subscriptions" });
    expect(res.suggestions).toHaveLength(0);
  });

  it("captures LLM failures without throwing", async () => {
    const llm: LLMClient = {
      name: "mock",
      defaultModel: "mock-1",
      complete: vi.fn().mockRejectedValue(new Error("unreachable")),
    };
    const res = await runPipeline([tx("x")], {
      rules: [],
      categories: [],
      policy: defaultPolicy,
      llm,
    });
    expect(res.llmFailures).toHaveLength(1);
    expect(res.labels).toHaveLength(0);
  });
});

describe("suggestRules", () => {
  it("derives a rule from multiple labeled examples in one category", async () => {
    const labeled = [
      { transactionId: "a", bookedAt: "2026-04-01", amountMinor: -1299, currency: "EUR", description: "Netflix.com", counterparty: "Netflix Intl BV", accountId: "acc-1", categoryId: "subs" },
      { transactionId: "b", bookedAt: "2026-05-01", amountMinor: -1299, currency: "EUR", description: "Netflix.com", counterparty: "Netflix Intl BV", accountId: "acc-1", categoryId: "subs" },
      { transactionId: "c", bookedAt: "2026-04-02", amountMinor: -650,  currency: "EUR", description: "BILLA",       counterparty: "BILLA 4411 Wien",  accountId: "acc-1", categoryId: "groceries" },
    ];
    const proposals = await suggestRules(labeled);
    const subs = proposals.find((p) => p.categoryId === "subs");
    expect(subs).toBeDefined();
    expect(subs?.source).toBe("heuristic");
    expect(subs?.supportCount).toBe(2);
  });

  it("skips categories below support threshold", async () => {
    const labeled = [
      { transactionId: "a", bookedAt: "2026-04-01", amountMinor: -1299, currency: "EUR", description: "x", counterparty: "Netflix", accountId: "acc-1", categoryId: "subs" },
    ];
    const proposals = await suggestRules(labeled);
    expect(proposals).toHaveLength(0);
  });
});
