import { Group } from "jazz-tools";
import {
  AISuggestion,
  AISuggestionList,
  Account,
  Category,
  Household,
  Rule,
  Tag,
  Transaction,
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

/**
 * Translate Jazz CoValues into the plain inputs the core pipeline expects.
 * Keeping this adapter thin makes the pipeline unit-testable without Jazz.
 */
export function readCompiledRules(household: Household): CompiledRule[] {
  const out: CompiledRule[] = [];
  for (const r of household.rules ?? []) {
    if (!r) continue;
    try {
      out.push({
        id: r.id,
        priority: r.priority,
        enabled: r.enabled,
        spec: parseRuleSpec(r.specJson),
      });
    } catch {
      // drop invalid rule \u2014 the Rules view surfaces it
    }
  }
  return out;
}

export function readCategories(household: Household): CategoryChoice[] {
  const out: CategoryChoice[] = [];
  for (const c of household.categories ?? []) {
    if (!c || c.archived) continue;
    out.push({ id: c.id, name: c.name });
  }
  return out;
}

export function readAllTransactions(household: Household): Array<{
  tx: Transaction;
  account: Account;
  pipelineInput: PipelineTransaction;
}> {
  const out: Array<{ tx: Transaction; account: Account; pipelineInput: PipelineTransaction }> = [];
  for (const a of household.accounts ?? []) {
    if (!a || a.archived) continue;
    for (const t of a.transactions ?? []) {
      if (!t) continue;
      out.push({
        tx: t,
        account: a,
        pipelineInput: {
          id: t.id,
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
  const labels = tx.labels ?? [];
  let chosen: string | undefined;
  for (const l of labels) {
    if (!l || l.revoked) continue;
    if (l.categoryRef) chosen = l.categoryRef.id;
  }
  return chosen;
}

export function readLabeledTransactions(household: Household): LabeledTransaction[] {
  const out: LabeledTransaction[] = [];
  for (const { tx, pipelineInput } of readAllTransactions(household)) {
    const categoryId = effectiveCategoryId(tx);
    if (!categoryId) continue;
    out.push({
      transactionId: tx.id,
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

export function applyLabelPlan(ctx: ApplyContext, plan: LabelPlan): TransactionLabel | null {
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
  ensureLabels(tx, ctx.group).push(label);

  if (plan.ruleId) {
    const rule = (ctx.household.rules ?? []).find((r): r is Rule => r?.id === plan.ruleId);
    if (rule) {
      rule.hitCount = (rule.hitCount ?? 0) + 1;
      rule.lastHitAt = new Date().toISOString();
    }
  }
  return label;
}

export function applySuggestionPlan(
  ctx: ApplyContext,
  plan: SuggestionPlan,
): AISuggestion | null {
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
  ensureSuggestions(tx, ctx.group).push(suggestion);
  return suggestion;
}

export function acceptSuggestion(
  ctx: ApplyContext,
  tx: Transaction,
  suggestion: AISuggestion,
): void {
  const label = TransactionLabel.create(
    {
      byAccountId: ctx.meAccountId,
      at: new Date().toISOString(),
      categoryRef: suggestion.suggestedCategoryRef ?? undefined,
      source: "llm-accepted",
      confidence: suggestion.confidence,
      note: suggestion.reasoning,
      revoked: false,
    } as never,
    { owner: ctx.group },
  );
  ensureLabels(tx, ctx.group).push(label);
  suggestion.accepted = true;
}

export function rejectSuggestion(suggestion: AISuggestion): void {
  suggestion.accepted = false;
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
): Rule {
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
  ctx.household.rules?.push(rule);
  return rule;
}

function findTransaction(h: Household, id: string): Transaction | undefined {
  for (const a of h.accounts ?? []) {
    for (const t of a?.transactions ?? []) {
      if (t?.id === id) return t;
    }
  }
  return undefined;
}

function findCategory(h: Household, id: string): Category | undefined {
  const hit = (h.categories ?? []).find((c) => c?.id === id);
  return hit ?? undefined;
}

function ensureLabels(tx: Transaction, group: Group): TransactionLabelList {
  if (tx.labels) return tx.labels;
  const list = TransactionLabelList.create([], { owner: group });
  tx.labels = list;
  return list;
}

function ensureSuggestions(tx: Transaction, group: Group): AISuggestionList {
  if (tx.suggestions) return tx.suggestions;
  const list = AISuggestionList.create([], { owner: group });
  tx.suggestions = list;
  return list;
}

export function createTag(
  ctx: ApplyContext,
  params: { name: string; color: string },
): Tag {
  const tag = Tag.create(
    { name: params.name, color: params.color, archived: false },
    { owner: ctx.group },
  );
  ctx.household.tags?.push(tag);
  return tag;
}

export function renameTag(tag: Tag, name: string): void {
  tag.name = name;
}

export function recolorTag(tag: Tag, color: string): void {
  tag.color = color;
}

export function archiveTag(tag: Tag, archived: boolean): void {
  tag.archived = archived;
}

export function addTagToTransaction(ctx: ApplyContext, tx: Transaction, tag: Tag): void {
  const label = TransactionLabel.create(
    {
      byAccountId: ctx.meAccountId,
      at: new Date().toISOString(),
      addTag: tag,
      source: "user",
      confidence: 1,
      revoked: false,
    } as never,
    { owner: ctx.group },
  );
  ensureLabels(tx, ctx.group).push(label);
}

export function removeTagFromTransaction(ctx: ApplyContext, tx: Transaction, tag: Tag): void {
  const label = TransactionLabel.create(
    {
      byAccountId: ctx.meAccountId,
      at: new Date().toISOString(),
      removeTag: tag,
      source: "user",
      confidence: 1,
      revoked: false,
    } as never,
    { owner: ctx.group },
  );
  ensureLabels(tx, ctx.group).push(label);
}

/**
 * Resolve a transaction's active tag ids by replaying the label overlay.
 * addTag adds, removeTag removes, revoked labels are skipped. Insertion
 * order defines the last-write-wins semantics for the same tag.
 */
export function effectiveTagIds(tx: Transaction): Set<string> {
  const active = new Set<string>();
  for (const l of tx.labels ?? []) {
    if (!l || l.revoked) continue;
    if (l.addTag) active.add(l.addTag.id);
    if (l.removeTag) active.delete(l.removeTag.id);
  }
  return active;
}

export function createCategory(
  ctx: ApplyContext,
  params: { name: string; color: string; icon?: string },
): Category {
  const category = Category.create(
    { name: params.name, color: params.color, icon: params.icon, archived: false },
    { owner: ctx.group },
  );
  ctx.household.categories?.push(category);
  return category;
}

export function renameCategory(category: Category, name: string): void {
  category.name = name;
}

export function recolorCategory(category: Category, color: string): void {
  category.color = color;
}

export function archiveCategory(category: Category, archived: boolean): void {
  category.archived = archived;
}

export type LabelRow = {
  transaction: Transaction;
  account: Account;
  label: TransactionLabel;
  categoryName?: string;
};

export function readAllLabels(household: Household): LabelRow[] {
  const categoryName = (id?: string) =>
    id ? (household.categories ?? []).find((c) => c?.id === id)?.name : undefined;
  const rows: LabelRow[] = [];
  for (const a of household.accounts ?? []) {
    if (!a) continue;
    for (const t of a.transactions ?? []) {
      if (!t) continue;
      for (const l of t.labels ?? []) {
        if (!l) continue;
        rows.push({
          transaction: t,
          account: a,
          label: l,
          categoryName: categoryName(l.categoryRef?.id),
        });
      }
    }
  }
  rows.sort((a, b) => (a.label.at < b.label.at ? 1 : -1));
  return rows;
}

export function revokeLabel(label: TransactionLabel): void {
  label.revoked = true;
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
  for (const a of ctx.household.accounts ?? []) {
    for (const t of a?.transactions ?? []) {
      if (!t || !ids.has(t.id)) continue;
      const label = TransactionLabel.create(
        {
          byAccountId: ctx.meAccountId,
          at: new Date().toISOString(),
          categoryRef: category,
          source,
          confidence: 1,
          revoked: false,
        } as never,
        { owner: ctx.group },
      );
      ensureLabels(t, ctx.group).push(label);
      applied++;
    }
  }
  return applied;
}

void TransactionList;
