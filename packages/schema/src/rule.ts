import { co, z } from "jazz-tools";

export const RuleSource = ["user", "llm", "derived"] as const;
export type RuleSourceT = (typeof RuleSource)[number];

/**
 * Matcher/action spec is stored as a JSON string to keep the Jazz schema flat.
 * The shape is defined by @resonable/core's RuleSpec type and enforced there.
 */
export const Rule = co.map({
  name: z.string(),
  specJson: z.string(),
  priority: z.number(),
  enabled: z.boolean(),
  source: z.string(),
  confidence: z.number(),
  createdByAccountId: z.string(),
  createdAt: z.string(),
  hitCount: z.number(),
  lastHitAt: z.optional(z.string()),
  disabledByAccountId: z.optional(z.string()),
  disabledAt: z.optional(z.string()),
  provenance: z.optional(z.string()),
  lastEditedByAccountId: z.optional(z.string()),
  lastEditedAt: z.optional(z.string()),
});
export type Rule = co.loaded<typeof Rule>;

export const RuleList = co.list(Rule);
export type RuleList = co.loaded<typeof RuleList>;
