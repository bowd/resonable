import type { LLMClient } from "./client";
import type { LabeledExample } from "../rules/learn";
import { matches } from "../rules/engine";
import { validateRuleSpec, type RuleSpec } from "../rules/spec";

const SYSTEM = `You derive a single conservative rule from labeled bank transactions.
The rule must generalize to similar future transactions but MUST NOT match any negative examples.
Return STRICT JSON matching:
{ "match": { "all": [Condition, ...] } | { "any": [Condition, ...] }, "action": { "setCategoryId": string } }
Condition kinds: merchantRegex, descriptionRegex, counterpartyEquals, counterpartyContains, amountRange, accountId, weekday.
Prefer counterpartyContains or counterpartyEquals with caseInsensitive: true. Use regex only when strings alone won't do.
Keep patterns short (<40 chars). Do not include any prose, JSON only.`;

/**
 * Ask the LLM to propose a rule, then validate it never fires on the
 * negatives. If it does, reject \u2014 the caller should fall back to
 * heuristic proposeRule from rules/learn.
 */
export async function llmProposeRule(
  llm: LLMClient,
  positives: LabeledExample[],
  negatives: LabeledExample[],
): Promise<RuleSpec | null> {
  if (positives.length < 2) return null;
  const categoryId = positives[0]!.categoryId;
  if (!positives.every((p) => p.categoryId === categoryId)) return null;

  const fmt = (xs: LabeledExample[]) =>
    xs.slice(0, 10)
      .map((x) => `  * amount=${x.amountMinor} ${x.currency}, counterparty=${JSON.stringify(x.counterparty ?? "")}, description=${JSON.stringify(x.description)}, account=${x.accountId}`)
      .join("\n");

  const user = `Target category id: ${categoryId}

Positives (must match):
${fmt(positives)}

Negatives (must NOT match):
${negatives.length ? fmt(negatives) : "  (none)"}

Return JSON only.`;

  const res = await llm.complete({
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: user },
    ],
    jsonSchema: true,
    temperature: 0,
    maxTokens: 400,
  });

  let spec: RuleSpec;
  try {
    const start = res.content.indexOf("{");
    const end = res.content.lastIndexOf("}");
    const raw = JSON.parse(res.content.slice(start, end + 1)) as Record<string, unknown>;
    if (!raw.action || typeof raw.action !== "object") return null;
    (raw.action as Record<string, unknown>).setCategoryId = categoryId;
    spec = validateRuleSpec(raw);
  } catch {
    return null;
  }

  for (const p of positives) if (!matches(p, spec.match)) return null;
  for (const n of negatives) if (matches(n, spec.match)) return null;
  return spec;
}
