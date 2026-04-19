import { co, z } from "jazz-tools";
import { Account, AccountList } from "./account";
import { Category, CategoryList } from "./category";
import { Tag, TagList } from "./tag";
import { Rule, RuleList } from "./rule";
import { Transaction, TransactionLabel, AISuggestion } from "./transaction";

/**
 * Root document for a household. Owned by a Jazz Group whose members
 * carry reader / writer / admin roles. Permission gating happens via
 * the Group; schema-level fields are informational only.
 */
export const Household = co.map({
  name: z.string(),
  createdAt: z.string(),
  createdByAccountId: z.string(),
  accounts: AccountList,
  categories: CategoryList,
  tags: TagList,
  rules: RuleList,
  /** Policy knobs for anti-griefing */
  newMemberDefaultRole: z.string(),
  requireAdminForRuleCreate: z.boolean(),
  allowLLMAutoApply: z.boolean(),
  autoApplyMinConfidence: z.number(),
});
export type Household = co.loaded<typeof Household>;

/**
 * Deep-loaded Household: accounts/categories/tags/rules and their immediate
 * children are all resolved. Most desktop bindings/views assume this shape,
 * so expose it as a dedicated type to keep call sites readable.
 */
export const HouseholdLoadResolve = {
  accounts: { $each: { transactions: { $each: { labels: { $each: true }, suggestions: { $each: true } } } } },
  categories: { $each: true },
  tags: { $each: true },
  rules: { $each: true },
} as const;

export type LoadedHousehold = co.loaded<typeof Household, typeof HouseholdLoadResolve>;
export type LoadedAccount = co.loaded<typeof Account, { transactions: { $each: { labels: { $each: true }, suggestions: { $each: true } } } }>;
export type LoadedTransaction = co.loaded<typeof Transaction, { labels: { $each: true }, suggestions: { $each: true } }>;
export type LoadedCategory = co.loaded<typeof Category>;
export type LoadedTag = co.loaded<typeof Tag>;
export type LoadedRule = co.loaded<typeof Rule>;
export type LoadedTransactionLabel = co.loaded<typeof TransactionLabel>;
export type LoadedAISuggestion = co.loaded<typeof AISuggestion>;
