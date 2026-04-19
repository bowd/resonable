import type { RuleInput, RuleSpec } from "./spec";
import { validateRuleSpec } from "./spec";
import { matches } from "./engine";

export type LabeledExample = RuleInput & { categoryId: string };

/**
 * Derive a conservative rule from a cluster of examples sharing one category.
 * Returns null if we can't find a confident minimal rule.
 *
 * \"negatives\" are examples with a different category \u2014 the proposed rule
 * must NOT match any of them, otherwise we reject the proposal.
 */
export function proposeRule(
  positives: LabeledExample[],
  negatives: LabeledExample[],
): RuleSpec | null {
  if (positives.length < 2) return null;
  const categoryId = positives[0]!.categoryId;
  if (!positives.every((p) => p.categoryId === categoryId)) return null;

  const proposal = tryCounterpartyEquals(positives, categoryId)
    ?? tryCounterpartyContains(positives, categoryId)
    ?? tryDescriptionContains(positives, categoryId);

  if (!proposal) return null;
  const spec = validateRuleSpec(proposal);

  for (const neg of negatives) {
    if (matches(neg, spec.match)) return null;
  }
  return spec;
}

function tryCounterpartyEquals(
  examples: LabeledExample[],
  categoryId: string,
): RuleSpec | null {
  const first = examples[0]!.counterparty?.trim();
  if (!first) return null;
  if (!examples.every((e) => e.counterparty?.trim() === first)) return null;
  return {
    match: { all: [{ kind: "counterpartyEquals", value: first, caseInsensitive: true }] },
    action: { setCategoryId: categoryId },
  };
}

function tryCounterpartyContains(
  examples: LabeledExample[],
  categoryId: string,
): RuleSpec | null {
  const tokens = examples.map((e) => (e.counterparty ?? "").toLowerCase().trim());
  if (tokens.some((t) => t.length === 0)) return null;
  const common = longestCommonSubstring(tokens);
  if (!common || common.length < 4) return null;
  return {
    match: { all: [{ kind: "counterpartyContains", value: common, caseInsensitive: true }] },
    action: { setCategoryId: categoryId },
  };
}

function tryDescriptionContains(
  examples: LabeledExample[],
  categoryId: string,
): RuleSpec | null {
  const tokens = examples.map((e) => e.description.toLowerCase());
  const common = longestCommonSubstring(tokens);
  if (!common || common.length < 6) return null;
  const pattern = escapeRegex(common);
  return {
    match: { all: [{ kind: "descriptionRegex", pattern, flags: "i" }] },
    action: { setCategoryId: categoryId },
  };
}

function longestCommonSubstring(strings: string[]): string | null {
  if (strings.length === 0) return null;
  if (strings.length === 1) return strings[0] ?? null;
  let [anchor, ...rest] = strings as [string, ...string[]];
  let best = "";
  for (let i = 0; i < anchor.length; i++) {
    for (let j = i + 1; j <= anchor.length; j++) {
      const candidate = anchor.slice(i, j);
      if (candidate.length <= best.length) continue;
      if (rest.every((s) => s.includes(candidate))) {
        best = candidate;
      }
    }
  }
  return best || null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
