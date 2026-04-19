import { describe, expect, it } from "vitest";
import { revolutFixture } from "./fixtures";
import { runPipeline, type PipelineTransaction } from "./pipeline";
import { suggestRules, type LabeledTransaction } from "./suggest-rules";
import { validateRuleSpec } from "../rules/spec";
import { defaultPolicy } from "../sync/moderation";
import type { LLMClient, LLMRequest, LLMResponse } from "../llm/client";

/**
 * End-to-end coverage of the import pipeline: deterministic rules + mocked
 * LLM fallback over the Revolut fixture, followed by rule-learning fed from
 * the pipeline's applied labels. Exercises the Jazz-free core paths exactly
 * as the app would call them, minus the CRDT write layer.
 */
describe("pipeline integration over revolut fixture", () => {
  const toPipelineTx = (accountId: string) =>
    (n: (typeof revolutFixture)[number]): PipelineTransaction => ({
      id: n.externalId,
      bookedAt: n.bookedAt,
      amountMinor: n.amountMinor,
      currency: n.currency,
      description: n.description,
      counterparty: n.counterparty,
      accountId,
    });

  const netflixRule = {
    id: "rule-netflix",
    priority: 10,
    enabled: true,
    spec: validateRuleSpec({
      match: {
        all: [{ kind: "counterpartyContains", value: "Netflix", caseInsensitive: true }],
      },
      action: { setCategoryId: "subscriptions" },
    }),
  };

  const categories = [
    { id: "subscriptions", name: "Subscriptions" },
    { id: "groceries", name: "Groceries" },
    { id: "transport", name: "Transport" },
    { id: "eating-out", name: "Eating Out" },
    { id: "income", name: "Income" },
  ];

  const mockLLM: LLMClient = {
    name: "mock",
    defaultModel: "mock-1",
    async complete(req: LLMRequest): Promise<LLMResponse> {
      const userMsg = req.messages.find((m) => m.role === "user")?.content ?? "";
      const pick = (): { categoryId: string | null; tags: string[]; confidence: number; reasoning: string } => {
        if (userMsg.includes("Spotify AB")) {
          return { categoryId: "subscriptions", tags: [], confidence: 0.9, reasoning: "streaming" };
        }
        if (userMsg.includes("BILLA 4411 Wien") || userMsg.includes("BILLA PLUS 2201")) {
          return { categoryId: "groceries", tags: [], confidence: 0.95, reasoning: "supermarket" };
        }
        return { categoryId: null, tags: [], confidence: 0.2, reasoning: "no idea" };
      };
      return { content: JSON.stringify(pick()), model: "mock-1" };
    },
  };

  it("labels Netflix via rule, auto-applies Spotify/BILLA via LLM, and suggests the salary credit", async () => {
    const txs = revolutFixture.map(toPipelineTx("acc-revolut"));

    const result = await runPipeline(txs, {
      rules: [netflixRule],
      categories,
      policy: { ...defaultPolicy, allowLLMAutoApply: true, autoApplyMinConfidence: 0.9 },
      llm: mockLLM,
    });

    // Deterministic rule should fire twice for the two Netflix charges.
    expect(result.ruleHits.get("rule-netflix")).toBe(2);

    const byId = new Map(result.labels.map((l) => [l.transactionId, l] as const));

    // Netflix: rule-sourced label.
    expect(byId.get("rv-001")).toMatchObject({
      source: "rule",
      ruleId: "rule-netflix",
      categoryId: "subscriptions",
      confidence: 1,
    });
    expect(byId.get("rv-007")).toMatchObject({
      source: "rule",
      ruleId: "rule-netflix",
      categoryId: "subscriptions",
    });

    // Spotify: LLM auto-applied at 0.9 (>= threshold).
    expect(byId.get("rv-002")).toMatchObject({
      source: "llm",
      categoryId: "subscriptions",
      confidence: 0.9,
    });
    expect(byId.get("rv-008")).toMatchObject({
      source: "llm",
      categoryId: "subscriptions",
    });

    // BILLA: LLM auto-applied at 0.95.
    expect(byId.get("rv-003")).toMatchObject({
      source: "llm",
      categoryId: "groceries",
      confidence: 0.95,
    });
    expect(byId.get("rv-004")).toMatchObject({
      source: "llm",
      categoryId: "groceries",
    });

    // Auto-applied + rule-applied labels: 2 Netflix + 2 Spotify + 2 BILLA.
    expect(result.labels).toHaveLength(6);

    // The salary credit, OEBB, and Figlmueller all fall through to suggestions
    // because the mock returns a sub-threshold null categoryId.
    const suggestionIds = result.suggestions.map((s) => s.transactionId).sort();
    expect(suggestionIds).toEqual(["rv-005", "rv-006", "rv-009"]);

    const salary = result.suggestions.find((s) => s.transactionId === "rv-009");
    expect(salary).toMatchObject({
      categoryId: null,
      confidence: 0.2,
      reasoning: "no idea",
      model: "mock-1",
    });

    expect(result.llmFailures).toHaveLength(0);
  });

  it("derives a groceries rule from the BILLA labels via suggestRules", async () => {
    const txs = revolutFixture.map(toPipelineTx("acc-revolut"));
    const result = await runPipeline(txs, {
      rules: [netflixRule],
      categories,
      policy: { ...defaultPolicy, allowLLMAutoApply: true, autoApplyMinConfidence: 0.9 },
      llm: mockLLM,
    });

    // Turn applied labels into the rule-learner's input shape.
    const txById = new Map(txs.map((t) => [t.id, t] as const));
    const labeled: LabeledTransaction[] = result.labels
      .filter((l) => l.categoryId)
      .map((l) => {
        const tx = txById.get(l.transactionId)!;
        return {
          transactionId: l.transactionId,
          bookedAt: tx.bookedAt,
          amountMinor: tx.amountMinor,
          currency: tx.currency,
          description: tx.description,
          counterparty: tx.counterparty,
          accountId: tx.accountId,
          categoryId: l.categoryId!,
        };
      });

    const proposals = await suggestRules(labeled);

    const groceries = proposals.find((p) => p.categoryId === "groceries");
    expect(groceries).toBeDefined();
    expect(groceries).toMatchObject({
      categoryId: "groceries",
      supportCount: 2,
      source: "heuristic",
    });
    expect(groceries?.sampleTransactionIds.sort()).toEqual(["rv-003", "rv-004"]);

    // Heuristic LCS of "billa 4411 wien" and "billa plus 2201" locks onto "billa ".
    expect(groceries?.spec.action).toMatchObject({ setCategoryId: "groceries" });
    const conds = "all" in groceries!.spec.match ? groceries!.spec.match.all : groceries!.spec.match.any;
    expect(conds).toHaveLength(1);
    const [cond] = conds;
    expect(cond).toMatchObject({ kind: "counterpartyContains", caseInsensitive: true });
    expect((cond as { value: string }).value.toLowerCase()).toContain("billa");
  });
});
