import { Group } from "jazz-tools";
import {
  AISuggestion,
  AISuggestionList,
  Category,
  type LoadedAccount,
  type LoadedAISuggestion,
  type LoadedCategory,
  type LoadedHousehold,
  type LoadedRule,
  type LoadedTag,
  type LoadedTransaction,
  type LoadedTransactionLabel,
  Rule,
  Tag,
  TransactionLabel,
  TransactionLabelList,
  TransactionList,
} from "@resonable/schema";
import {
  parseRuleSpec,
  type CompiledRule,
  type LabelPlan,
  type PipelineTransaction,
  type SuggestionPlan,
  type LabeledTransaction,
  type CategoryChoice,
} from "@resonable/core";

type Household = LoadedHousehold;
type Account = LoadedAccount;
type Transaction = LoadedTransaction;

/**
 * Deep-loaded CoLists from Jazz typecheck as `ReadonlyArray<Loaded> & CoList<MaybeLoaded>`,
 * whose two halves disagree on the iterator element type. TS therefore refuses to `for-of`
 * the intersection. These helpers return a plain array view for iteration.
 */
const asArr = <T>(x: ArrayLike<T>): ReadonlyArray<T> => x as unknown as ReadonlyArray<T>;

/**
 * Translate Jazz CoValues into the plain inputs the core pipeline expects.
 * Keeping this adapter thin makes the pipeline unit-testable without Jazz.
 */
export function readCompiledRules(household: Household): CompiledRule[] {
  const out: CompiledRule[] = [];
  for (const r of asArr<LoadedRule>(household.rules)) {
    if (!r) continue;
    try {
      out.push({
        id: r.$jazz.id,
        priority: r.priority,
        enabled: r.enabled,
        spec: parseRuleSpec(r.specJson),
      });
    } catch {
      // drop invalid rule — the Rules view surfaces it
    }
  }
  return out;
}

export function readCategories(household: Household): CategoryChoice[] {
  const out: CategoryChoice[] = [];
  for (const c of asArr<LoadedCategory>(household.categories)) {
    if (!c || c.archived) continue;
    out.push({ id: c.$jazz.id, name: c.name });
  }
  return out;
}

export function readAllTransactions(household: Household): Array<{
  tx: Transaction;
  account: Account;
  pipelineInput: PipelineTransaction;
}> {
  const out: Array<{ tx: Transaction; account: Account; pipelineInput: PipelineTransaction }> = [];
  for (const a of asArr<Account>(household.accounts)) {
    if (!a || a.archived) continue;
    for (const t of asArr<Transaction>(a.transactions)) {
      if (!t) continue;
      out.push({
        tx: t,
        account: a,
        pipelineInput: {
          id: t.$jazz.id,
          bookedAt: t.bookedAt,
          amountMinor: t.amountMinor,
          currency: t.currency,
          description: t.description,
          counterparty: t.counterparty ?? undefined,
          accountId: t.accountId,
          accountName: a.name,
        },
      });
    }
  }
  return out;
}

/**
 * Collapse a transaction's label overlays into a single "effective" category.
 * Latest non-revoked categoryRef label wins. Ties broken by insertion order.
 */
export function effectiveCategoryId(tx: Transaction): string | undefined {
  let chosen: string | undefined;
  for (const l of asArr<LoadedTransactionLabel>(tx.labels)) {
    if (!l || l.revoked) continue;
    if (l.categoryRef) chosen = l.categoryRef.$jazz.id;
  }
  return chosen;
}

export function readLabeledTransactions(household: Household): LabeledTransaction[] {
  const out: LabeledTransaction[] = [];
  for (const { tx, pipelineInput } of readAllTransactions(household)) {
    const categoryId = effectiveCategoryId(tx);
    if (!categoryId) continue;
    out.push({
      transactionId: tx.$jazz.id,
      categoryId,
      bookedAt: pipelineInput.bookedAt,
      amountMinor: pipelineInput.amountMinor,
      currency: pipelineInput.currency,
      description: pipelineInput.description,
      counterparty: pipelineInput.counterparty,
      accountId: pipelineInput.accountId,
    });
  }
  return out;
}

export type ApplyContext = {
  household: Household;
  meAccountId: string;
  group: Group;
};

export function applyLabelPlan(ctx: ApplyContext, plan: LabelPlan): LoadedTransactionLabel | null {
  const tx = findTransaction(ctx.household, plan.transactionId);
  if (!tx) return null;
  const category = plan.categoryId ? findCategory(ctx.household, plan.categoryId) : undefined;
  const label = TransactionLabel.create(
    {
      byAccountId: ctx.meAccountId,
      at: new Date().toISOString(),
      categoryRef: category,
      source: plan.source,
      ruleId: plan.ruleId,
      confidence: plan.confidence,
      note: plan.reasoning,
      revoked: false,
    },
    { owner: ctx.group },
  );
  ensureLabels(tx, ctx.group).$jazz.push(label);

  if (plan.ruleId) {
    const rule = findRule(ctx.household, plan.ruleId);
    if (rule) {
      rule.$jazz.set("hitCount", (rule.hitCount ?? 0) + 1);
      rule.$jazz.set("lastHitAt", new Date().toISOString());
    }
  }
  return label;
}

export function applySuggestionPlan(
  ctx: ApplyContext,
  plan: SuggestionPlan,
): LoadedAISuggestion | null {
  const tx = findTransaction(ctx.household, plan.transactionId);
  if (!tx) return null;
  const suggestedCategory = plan.categoryId
    ? findCategory(ctx.household, plan.categoryId)
    : undefined;
  const suggestion = AISuggestion.create(
    {
      at: new Date().toISOString(),
      model: plan.model,
      suggestedCategoryRef: suggestedCategory,
      suggestedTagsJson: JSON.stringify(plan.tags),
      reasoning: plan.reasoning,
      confidence: plan.confidence,
    },
    { owner: ctx.group },
  );
  ensureSuggestions(tx, ctx.group).$jazz.push(suggestion);
  return suggestion;
}

export function acceptSuggestion(
  ctx: ApplyContext,
  tx: Transaction,
  suggestion: LoadedAISuggestion,
): void {
  const suggestedCat = suggestion.suggestedCategoryRef;
  const label = TransactionLabel.create(
    {
      byAccountId: ctx.meAccountId,
      at: new Date().toISOString(),
      categoryRef: suggestedCat && suggestedCat.$isLoaded ? suggestedCat : undefined,
      source: "llm-accepted",
      confidence: suggestion.confidence,
      note: suggestion.reasoning,
      revoked: false,
    },
    { owner: ctx.group },
  );
  ensureLabels(tx, ctx.group).$jazz.push(label);
  suggestion.$jazz.set("accepted", true);
}

export function rejectSuggestion(suggestion: LoadedAISuggestion): void {
  suggestion.$jazz.set("accepted", false);
}

export function createRule(
  ctx: ApplyContext,
  params: {
    name: string;
    specJson: string;
    priority?: number;
    source: "user" | "llm" | "derived";
    confidence?: number;
    provenance?: string;
  },
): LoadedRule {
  // Validate first so we never persist an un-parseable spec.
  parseRuleSpec(params.specJson);
  const rule = Rule.create(
    {
      name: params.name,
      specJson: params.specJson,
      priority: params.priority ?? 0,
      enabled: true,
      source: params.source,
      confidence: params.confidence ?? 1,
      createdByAccountId: ctx.meAccountId,
      createdAt: new Date().toISOString(),
      hitCount: 0,
      provenance: params.provenance,
    },
    { owner: ctx.group },
  );
  ctx.household.rules.$jazz.push(rule);
  return rule;
}

function findTransaction(h: Household, id: string): Transaction | undefined {
  for (const a of asArr<Account>(h.accounts)) {
    for (const t of asArr<Transaction>(a.transactions)) {
      if (t?.$jazz.id === id) return t;
    }
  }
  return undefined;
}

function findCategory(h: Household, id: string): LoadedCategory | undefined {
  for (const c of asArr<LoadedCategory>(h.categories)) {
    if (c?.$jazz.id === id) return c;
  }
  return undefined;
}

function findRule(h: Household, id: string): LoadedRule | undefined {
  for (const r of asArr<LoadedRule>(h.rules)) {
    if (r?.$jazz.id === id) return r;
  }
  return undefined;
}

function ensureLabels(tx: Transaction, group: Group) {
  if (tx.labels) return tx.labels;
  const list = TransactionLabelList.create([], { owner: group });
  tx.$jazz.set("labels", list);
  return list;
}

function ensureSuggestions(tx: Transaction, group: Group) {
  if (tx.suggestions) return tx.suggestions;
  const list = AISuggestionList.create([], { owner: group });
  tx.$jazz.set("suggestions", list);
  return list;
}

export function createTag(
  ctx: ApplyContext,
  params: { name: string; color: string },
): LoadedTag {
  const tag = Tag.create(
    { name: params.name, color: params.color, archived: false },
    { owner: ctx.group },
  );
  ctx.household.tags.$jazz.push(tag);
  return tag;
}

export function renameTag(tag: LoadedTag, name: string): void {
  tag.$jazz.set("name", name);
}

export function recolorTag(tag: LoadedTag, color: string): void {
  tag.$jazz.set("color", color);
}

export function archiveTag(tag: LoadedTag, archived: boolean): void {
  tag.$jazz.set("archived", archived);
}

export function addTagToTransaction(ctx: ApplyContext, tx: Transaction, tag: LoadedTag): void {
  const label = TransactionLabel.create(
    {
      byAccountId: ctx.meAccountId,
      at: new Date().toISOString(),
      addTag: tag,
      source: "user",
      confidence: 1,
      revoked: false,
    },
    { owner: ctx.group },
  );
  ensureLabels(tx, ctx.group).$jazz.push(label);
}

export function removeTagFromTransaction(ctx: ApplyContext, tx: Transaction, tag: LoadedTag): void {
  const label = TransactionLabel.create(
    {
      byAccountId: ctx.meAccountId,
      at: new Date().toISOString(),
      removeTag: tag,
      source: "user",
      confidence: 1,
      revoked: false,
    },
    { owner: ctx.group },
  );
  ensureLabels(tx, ctx.group).$jazz.push(label);
}

/**
 * Resolve a transaction's active tag ids by replaying the label overlay.
 * addTag adds, removeTag removes, revoked labels are skipped. Insertion
 * order defines the last-write-wins semantics for the same tag.
 */
export function effectiveTagIds(tx: Transaction): Set<string> {
  const active = new Set<string>();
  for (const l of asArr<LoadedTransactionLabel>(tx.labels)) {
    if (!l || l.revoked) continue;
    if (l.addTag) active.add(l.addTag.$jazz.id);
    if (l.removeTag) active.delete(l.removeTag.$jazz.id);
  }
  return active;
}

export function createCategory(
  ctx: ApplyContext,
  params: { name: string; color: string; icon?: string },
): LoadedCategory {
  const category = Category.create(
    { name: params.name, color: params.color, icon: params.icon, archived: false },
    { owner: ctx.group },
  );
  ctx.household.categories.$jazz.push(category);
  return category;
}

export function renameCategory(category: LoadedCategory, name: string): void {
  category.$jazz.set("name", name);
}

export function recolorCategory(category: LoadedCategory, color: string): void {
  category.$jazz.set("color", color);
}

export function archiveCategory(category: LoadedCategory, archived: boolean): void {
  category.$jazz.set("archived", archived);
}

export type LabelRow = {
  transaction: Transaction;
  account: Account;
  label: LoadedTransactionLabel;
  categoryName?: string;
};

export function readAllLabels(household: Household): LabelRow[] {
  const categoryName = (id?: string) => {
    if (!id) return undefined;
    for (const c of asArr<LoadedCategory>(household.categories)) {
      if (c?.$jazz.id === id) return c.name;
    }
    return undefined;
  };
  const rows: LabelRow[] = [];
  for (const a of asArr<Account>(household.accounts)) {
    if (!a) continue;
    for (const t of asArr<Transaction>(a.transactions)) {
      if (!t) continue;
      for (const l of asArr<LoadedTransactionLabel>(t.labels)) {
        if (!l) continue;
        rows.push({
          transaction: t,
          account: a,
          label: l,
          categoryName: categoryName(l.categoryRef?.$jazz.id),
        });
      }
    }
  }
  rows.sort((a, b) => (a.label.at < b.label.at ? 1 : -1));
  return rows;
}

export function revokeLabel(label: LoadedTransactionLabel): void {
  label.$jazz.set("revoked", true);
}

/**
 * Assign the same category to a batch of transactions in a single pass.
 * Emits one TransactionLabel overlay per transaction with source="user-bulk".
 */
export function bulkApplyCategory(
  ctx: ApplyContext,
  transactionIds: string[],
  categoryId: string,
  source: "user" | "user-bulk" | "llm-accepted" = "user-bulk",
): number {
  const category = findCategory(ctx.household, categoryId);
  if (!category) return 0;
  let applied = 0;
  const ids = new Set(transactionIds);
  for (const a of asArr<Account>(ctx.household.accounts)) {
    for (const t of asArr<Transaction>(a.transactions)) {
      if (!t || !ids.has(t.$jazz.id)) continue;
      const label = TransactionLabel.create(
        {
          byAccountId: ctx.meAccountId,
          at: new Date().toISOString(),
          categoryRef: category,
          source,
          confidence: 1,
          revoked: false,
        },
        { owner: ctx.group },
      );
      ensureLabels(t, ctx.group).$jazz.push(label);
      applied++;
    }
  }
  return applied;
}

void TransactionList;
