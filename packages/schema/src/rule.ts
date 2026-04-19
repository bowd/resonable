import { CoMap, CoList, co } from "jazz-tools";

export const RuleSource = ["user", "llm", "derived"] as const;
export type RuleSourceT = (typeof RuleSource)[number];

/**
 * Matcher/action spec is stored as a JSON string to keep the Jazz schema flat.
 * The shape is defined by @resonable/core's RuleSpec type and enforced there.
 */
export class Rule extends CoMap {
  name = co.string;
  specJson = co.string;
  priority = co.number;
  enabled = co.boolean;
  source = co.string;
  confidence = co.number;
  createdByAccountId = co.string;
  createdAt = co.string;
  hitCount = co.number;
  lastHitAt = co.optional.string;
  disabledByAccountId = co.optional.string;
  disabledAt = co.optional.string;
  provenance = co.optional.string;
  lastEditedByAccountId = co.optional.string;
  lastEditedAt = co.optional.string;
}

export class RuleList extends CoList.Of(co.ref(Rule)) {}
