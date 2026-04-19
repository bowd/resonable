import { CoMap, CoList, co } from "jazz-tools";
import { Category } from "./category";
import { Tag } from "./tag";

/**
 * A single label contribution. Transactions accumulate labels as an append-only
 * overlay so we can audit who tagged what, and admins can roll back griefing
 * without losing the history of legitimate labels.
 */
export class TransactionLabel extends CoMap {
  byAccountId = co.string;
  at = co.string;
  categoryRef = co.optional.ref(Category);
  addTag = co.optional.ref(Tag);
  removeTag = co.optional.ref(Tag);
  note = co.optional.string;
  source = co.string;
  ruleId = co.optional.string;
  confidence = co.optional.number;
  revoked = co.boolean;
}

export class TransactionLabelList extends CoList.Of(co.ref(TransactionLabel)) {}

export class AISuggestion extends CoMap {
  at = co.string;
  model = co.string;
  suggestedCategoryRef = co.optional.ref(Category);
  suggestedTagsJson = co.string;
  reasoning = co.string;
  confidence = co.number;
  accepted = co.optional.boolean;
  resultingRuleId = co.optional.string;
}

export class AISuggestionList extends CoList.Of(co.ref(AISuggestion)) {}

export class Transaction extends CoMap {
  externalId = co.string;
  bookedAt = co.string;
  valueDate = co.optional.string;
  amountMinor = co.number;
  currency = co.string;
  counterparty = co.optional.string;
  description = co.string;
  rawPayloadJson = co.string;
  accountId = co.string;
  labels = co.ref(TransactionLabelList);
  suggestions = co.ref(AISuggestionList);
}

export class TransactionList extends CoList.Of(co.ref(Transaction)) {}
