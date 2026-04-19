import type { LLMClient } from "../llm/client";
import { proposeRule, type LabeledExample } from "../rules/learn";
import { llmProposeRule } from "../llm/rule-learn";
import type { RuleSpec } from "../rules/spec";

export type LabeledTransaction = LabeledExample & {
  transactionId: string;
};

export type RuleProposal = {
  categoryId: string;
  supportCount: number;
  source: "heuristic" | "llm";
  spec: RuleSpec;
  sampleTransactionIds: string[];
};

export type SuggestRulesOptions = {
  /** Minimum positives per category to propose a rule. */
  minSupport?: number;
  /** Max LLM fallbacks to run. */
  maxLLMCalls?: number;
  /** Fall back to LLM when the heuristic rejects. */
  useLLM?: boolean;
  signal?: AbortSignal;
};

/**
 * Walk labeled transactions, group by categoryId, and propose one minimal
 * rule per category. Heuristic proposer runs first (free, deterministic);
 * LLM only runs for categories where the heuristic couldn't lock in.
 *
 * All proposals are validated against the full set of negatives before
 * being returned \u2014 a rule that would mis-tag an already-labeled transaction
 * in a different category is rejected.
 */
export async function suggestRules(
  labeled: LabeledTransaction[],
  opts: SuggestRulesOptions & { llm?: LLMClient } = {},
): Promise<RuleProposal[]> {
  const minSupport = opts.minSupport ?? 2;
  const maxLLM = opts.maxLLMCalls ?? 5;

  const byCategory = new Map<string, LabeledTransaction[]>();
  for (const lt of labeled) {
    const bucket = byCategory.get(lt.categoryId) ?? [];
    bucket.push(lt);
    byCategory.set(lt.categoryId, bucket);
  }

  const proposals: RuleProposal[] = [];
  let llmCallsRemaining = opts.useLLM && opts.llm ? maxLLM : 0;

  for (const [categoryId, positives] of byCategory) {
    if (positives.length < minSupport) continue;
    const negatives = labeled.filter((x) => x.categoryId !== categoryId);
    if (opts.signal?.aborted) break;

    const heuristic = proposeRule(positives, negatives);
    if (heuristic) {
      proposals.push({
        categoryId,
        supportCount: positives.length,
        source: "heuristic",
        spec: heuristic,
        sampleTransactionIds: positives.slice(0, 5).map((p) => p.transactionId),
      });
      continue;
    }

    if (llmCallsRemaining > 0 && opts.llm) {
      llmCallsRemaining--;
      const llmSpec = await llmProposeRule(opts.llm, positives, negatives);
      if (llmSpec) {
        proposals.push({
          categoryId,
          supportCount: positives.length,
          source: "llm",
          spec: llmSpec,
          sampleTransactionIds: positives.slice(0, 5).map((p) => p.transactionId),
        });
      }
    }
  }

  return proposals;
}
