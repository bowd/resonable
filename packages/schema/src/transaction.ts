import { co, z } from "jazz-tools";
import { Category } from "./category";
import { Tag } from "./tag";

/**
 * A single label contribution. Transactions accumulate labels as an append-only
 * overlay so we can audit who tagged what, and admins can roll back griefing
 * without losing the history of legitimate labels.
 */
export const TransactionLabel = co.map({
  byAccountId: z.string(),
  at: z.string(),
  categoryRef: co.optional(Category),
  addTag: co.optional(Tag),
  removeTag: co.optional(Tag),
  note: z.optional(z.string()),
  source: z.string(),
  ruleId: z.optional(z.string()),
  confidence: z.optional(z.number()),
  revoked: z.boolean(),
});
export type TransactionLabel = co.loaded<typeof TransactionLabel>;

export const TransactionLabelList = co.list(TransactionLabel);
export type TransactionLabelList = co.loaded<typeof TransactionLabelList>;

export const AISuggestion = co.map({
  at: z.string(),
  model: z.string(),
  suggestedCategoryRef: co.optional(Category),
  suggestedTagsJson: z.string(),
  reasoning: z.string(),
  confidence: z.number(),
  accepted: z.optional(z.boolean()),
  resultingRuleId: z.optional(z.string()),
});
export type AISuggestion = co.loaded<typeof AISuggestion>;

export const AISuggestionList = co.list(AISuggestion);
export type AISuggestionList = co.loaded<typeof AISuggestionList>;

export const Transaction = co.map({
  externalId: z.string(),
  bookedAt: z.string(),
  valueDate: z.optional(z.string()),
  amountMinor: z.number(),
  currency: z.string(),
  counterparty: z.optional(z.string()),
  description: z.string(),
  rawPayloadJson: z.string(),
  accountId: z.string(),
  labels: TransactionLabelList,
  suggestions: AISuggestionList,
});
export type Transaction = co.loaded<typeof Transaction>;

export const TransactionList = co.list(Transaction);
export type TransactionList = co.loaded<typeof TransactionList>;
