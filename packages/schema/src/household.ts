import { CoMap, co } from "jazz-tools";
import { AccountList } from "./account";
import { CategoryList } from "./category";
import { TagList } from "./tag";
import { RuleList } from "./rule";

/**
 * Root document for a household. Owned by a Jazz Group whose members
 * carry reader / writer / admin roles. Permission gating happens via
 * the Group; schema-level fields are informational only.
 */
export class Household extends CoMap {
  name = co.string;
  createdAt = co.string;
  createdByAccountId = co.string;
  accounts = co.ref(AccountList);
  categories = co.ref(CategoryList);
  tags = co.ref(TagList);
  rules = co.ref(RuleList);
  /** Policy knobs for anti-griefing */
  newMemberDefaultRole = co.string;
  requireAdminForRuleCreate = co.boolean;
  allowLLMAutoApply = co.boolean;
  autoApplyMinConfidence = co.number;
}
