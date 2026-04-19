import { evaluate, type CompiledRule } from "../rules/engine";
import type { RuleInput } from "../rules/spec";
import type { LLMClient } from "../llm/client";
import { classifyTransaction, type CategoryChoice } from "../llm/classify";
import type { HouseholdPolicy } from "../sync/moderation";

export type PipelineTransaction = RuleInput & {
  id: string;
  description: string;
  counterparty?: string;
  accountName?: string;
};

export type LabelPlan = {
  transactionId: string;
  source: "rule" | "llm";
  categoryId?: string;
  tagIds?: string[];
  ruleId?: string;
  confidence: number;
  reasoning?: string;
};

export type SuggestionPlan = {
  transactionId: string;
  categoryId: string | null;
  tags: string[];
  confidence: number;
  reasoning: string;
  model: string;
};

export type PipelineResult = {
  labels: LabelPlan[];
  suggestions: SuggestionPlan[];
  ruleHits: Map<string, number>;
  llmFailures: Array<{ transactionId: string; error: string }>;
};

export type PipelineOptions = {
  rules: CompiledRule[];
  categories: CategoryChoice[];
  policy: HouseholdPolicy;
  llm?: LLMClient;
  llmModelName?: string;
  /** Optional cap on how many tx go to the LLM in one batch. */
  maxLLMCalls?: number;
  signal?: AbortSignal;
};

/**
 * Classify a batch of transactions: deterministic rules first, LLM fallback
 * for anything left over. Returns plain-data plans that the app applies to
 * the Jazz CoValue layer. The pipeline itself holds no Jazz state so it is
 * trivially testable.
 */
export async function runPipeline(
  transactions: PipelineTransaction[],
  opts: PipelineOptions,
): Promise<PipelineResult> {
  const result: PipelineResult = {
    labels: [],
    suggestions: [],
    ruleHits: new Map(),
    llmFailures: [],
  };

  const unmatched: PipelineTransaction[] = [];
  for (const tx of transactions) {
    const match = evaluate(tx, opts.rules);
    if (!match) {
      unmatched.push(tx);
      continue;
    }
    result.labels.push({
      transactionId: tx.id,
      source: "rule",
      categoryId: match.action.setCategoryId,
      tagIds: match.action.addTagIds,
      ruleId: match.ruleId,
      confidence: 1,
    });
    result.ruleHits.set(match.ruleId, (result.ruleHits.get(match.ruleId) ?? 0) + 1);
  }

  if (!opts.llm || unmatched.length === 0) return result;

  const budget = Math.min(unmatched.length, opts.maxLLMCalls ?? unmatched.length);
  for (let i = 0; i < budget; i++) {
    const tx = unmatched[i]!;
    if (opts.signal?.aborted) break;
    try {
      const res = await classifyTransaction(opts.llm, tx, opts.categories);
      const canAuto =
        opts.policy.allowLLMAutoApply &&
        res.categoryId !== null &&
        res.confidence >= opts.policy.autoApplyMinConfidence;
      if (canAuto && res.categoryId) {
        result.labels.push({
          transactionId: tx.id,
          source: "llm",
          categoryId: res.categoryId,
          confidence: res.confidence,
          reasoning: res.reasoning,
        });
      } else {
        result.suggestions.push({
          transactionId: tx.id,
          categoryId: res.categoryId,
          tags: res.tags,
          confidence: res.confidence,
          reasoning: res.reasoning,
          model: opts.llmModelName ?? opts.llm.defaultModel,
        });
      }
    } catch (err) {
      result.llmFailures.push({
        transactionId: tx.id,
        error: (err as Error).message,
      });
    }
  }

  return result;
}
