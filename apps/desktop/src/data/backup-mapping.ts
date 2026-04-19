import {
  Account,
  AISuggestionList,
  Category,
  Connection,
  Rule,
  Tag,
  Transaction,
  TransactionLabel,
  TransactionLabelList,
  TransactionList,
  type LoadedAccount,
  type LoadedCategory,
  type LoadedHousehold,
  type LoadedRule,
  type LoadedTag,
  type LoadedTransaction,
  type LoadedTransactionLabel,
} from "@resonable/schema";
import type {
  BackupAccount,
  BackupCategory,
  BackupLabel,
  BackupPayload,
  BackupRule,
  BackupTag,
  BackupTransaction,
} from "@resonable/core";
import type { ApplyContext } from "./bindings";

/**
 * Deep-loaded CoLists behave as ArrayLike; `for..of` on the intersection type
 * trips TS, so we narrow them to a plain ReadonlyArray view for iteration.
 * (Same trick as bindings.ts; repeated here to avoid a cross-module dep.)
 */
const asArr = <T>(x: ArrayLike<T>): ReadonlyArray<T> => x as unknown as ReadonlyArray<T>;

export type BackupApplyResult = {
  addedCounts: {
    accounts: number;
    transactions: number;
    labels: number;
    rules: number;
    categories: number;
    tags: number;
  };
};

/**
 * Collapse a LoadedHousehold tree into a plain, versioned BackupPayload.
 * CoValue ids become `externalId` fields so the payload survives a round
 * trip that necessarily mints fresh ids on restore. Labels reference their
 * category/tag/rule by the same `externalId` strings.
 */
export function toBackupPayload(household: LoadedHousehold): BackupPayload {
  const categories: BackupCategory[] = [];
  for (const c of asArr<LoadedCategory>(household.categories)) {
    if (!c) continue;
    categories.push({
      externalId: c.$jazz.id,
      name: c.name,
      color: c.color,
      icon: c.icon ?? undefined,
      archived: c.archived,
    });
  }

  const tags: BackupTag[] = [];
  for (const t of asArr<LoadedTag>(household.tags)) {
    if (!t) continue;
    tags.push({
      externalId: t.$jazz.id,
      name: t.name,
      color: t.color,
      archived: t.archived,
    });
  }

  const rules: BackupRule[] = [];
  for (const r of asArr<LoadedRule>(household.rules)) {
    if (!r) continue;
    rules.push({
      externalId: r.$jazz.id,
      name: r.name,
      specJson: r.specJson,
      priority: r.priority,
      enabled: r.enabled,
      source: r.source,
      confidence: r.confidence,
      createdByAccountId: r.createdByAccountId,
      createdAt: r.createdAt,
      hitCount: r.hitCount ?? 0,
      provenance: r.provenance ?? undefined,
    });
  }

  const accounts: BackupAccount[] = [];
  for (const a of asArr<LoadedAccount>(household.accounts)) {
    if (!a) continue;
    const transactions: BackupTransaction[] = [];
    for (const t of asArr<LoadedTransaction>(a.transactions)) {
      if (!t) continue;
      const labels: BackupLabel[] = [];
      for (const l of asArr<LoadedTransactionLabel>(t.labels)) {
        if (!l) continue;
        labels.push(snapshotLabel(l));
      }
      transactions.push({
        externalId: t.externalId,
        bookedAt: t.bookedAt,
        valueDate: t.valueDate ?? undefined,
        amountMinor: t.amountMinor,
        currency: t.currency,
        counterparty: t.counterparty ?? undefined,
        description: t.description,
        rawPayloadJson: t.rawPayloadJson,
        labels,
      });
    }
    accounts.push({
      externalId: a.externalId,
      name: a.name,
      institutionName: a.institutionName,
      currency: a.currency,
      iban: a.iban ?? undefined,
      archived: a.archived,
      createdAt: a.createdAt,
      transactions,
    });
  }

  return {
    version: 1,
    householdName: household.name,
    createdAt: new Date().toISOString(),
    accounts,
    categories,
    tags,
    rules,
  };
}

function snapshotLabel(l: LoadedTransactionLabel): BackupLabel {
  return {
    byAccountId: l.byAccountId,
    at: l.at,
    categoryExternalId: l.categoryRef?.$jazz.id,
    addTagExternalId: l.addTag?.$jazz.id,
    removeTagExternalId: l.removeTag?.$jazz.id,
    source: l.source,
    ruleId: l.ruleId ?? undefined,
    confidence: l.confidence ?? undefined,
    note: l.note ?? undefined,
    revoked: l.revoked,
  };
}

/**
 * Write a BackupPayload into the given household.
 *
 * Default strategy is `merge`:
 *   - Accounts and their transactions are deduped by `externalId` (the bank's
 *     stable id), not Jazz CoValue id.
 *   - Categories and Tags are deduped by `name` (case-sensitive).
 *   - Rules are deduped by `name + specJson` tuple.
 *   - Labels are always appended (the overlay is append-only by design), and
 *     their `categoryRef`/`addTag`/`removeTag` fields are resolved through a
 *     name-indexed map built during this restore pass so we can point at the
 *     freshly-created CoValues.
 *
 * `replace` is reserved for a future pass; for now it behaves like `merge`
 * since we never destructively wipe CoValues.
 */
export function applyBackupPayload(
  ctx: ApplyContext,
  payload: BackupPayload,
  _opts?: { strategy: "merge" | "replace" },
): BackupApplyResult {
  const { household, group } = ctx;

  // Index what's already present so we can skip duplicates.
  const categoryByName = new Map<string, LoadedCategory>();
  for (const c of asArr<LoadedCategory>(household.categories)) {
    if (c) categoryByName.set(c.name, c);
  }
  const tagByName = new Map<string, LoadedTag>();
  for (const t of asArr<LoadedTag>(household.tags)) {
    if (t) tagByName.set(t.name, t);
  }
  const ruleKey = (name: string, specJson: string) => `${name}\u0000${specJson}`;
  const ruleByKey = new Map<string, LoadedRule>();
  for (const r of asArr<LoadedRule>(household.rules)) {
    if (r) ruleByKey.set(ruleKey(r.name, r.specJson), r);
  }
  const accountByExtId = new Map<string, LoadedAccount>();
  for (const a of asArr<LoadedAccount>(household.accounts)) {
    if (a) accountByExtId.set(a.externalId, a);
  }

  const counts = { accounts: 0, transactions: 0, labels: 0, rules: 0, categories: 0, tags: 0 };

  // A map from payload externalId (the exporter's CoValue id) to the target
  // Loaded CoValue in this restore pass. Used when resolving label refs.
  const categoryByExtId = new Map<string, LoadedCategory>();
  const tagByExtId = new Map<string, LoadedTag>();

  // Categories
  for (const bc of payload.categories) {
    const existing = categoryByName.get(bc.name);
    if (existing) {
      categoryByExtId.set(bc.externalId, existing);
      continue;
    }
    const created = Category.create(
      { name: bc.name, color: bc.color, icon: bc.icon, archived: bc.archived },
      { owner: group },
    );
    household.categories.$jazz.push(created);
    categoryByName.set(bc.name, created);
    categoryByExtId.set(bc.externalId, created);
    counts.categories++;
  }

  // Tags
  for (const bt of payload.tags) {
    const existing = tagByName.get(bt.name);
    if (existing) {
      tagByExtId.set(bt.externalId, existing);
      continue;
    }
    const created = Tag.create(
      { name: bt.name, color: bt.color, archived: bt.archived },
      { owner: group },
    );
    household.tags.$jazz.push(created);
    tagByName.set(bt.name, created);
    tagByExtId.set(bt.externalId, created);
    counts.tags++;
  }

  // Rules (identity: name + specJson)
  for (const br of payload.rules) {
    const key = ruleKey(br.name, br.specJson);
    if (ruleByKey.has(key)) continue;
    const created = Rule.create(
      {
        name: br.name,
        specJson: br.specJson,
        priority: br.priority,
        enabled: br.enabled,
        source: br.source,
        confidence: br.confidence,
        createdByAccountId: br.createdByAccountId,
        createdAt: br.createdAt,
        hitCount: br.hitCount,
        provenance: br.provenance,
      },
      { owner: group },
    );
    household.rules.$jazz.push(created);
    ruleByKey.set(key, created);
    counts.rules++;
  }

  // Accounts + transactions + labels
  for (const ba of payload.accounts) {
    let account = accountByExtId.get(ba.externalId);
    if (!account) {
      // Minimal Connection stub so the Account schema is satisfied. The real
      // bank credentials stay in the original owner's keychain; an imported
      // account is treated as read-only until re-linked.
      const connection = Connection.create(
        {
          provider: "backup-restore",
          institutionId: ba.institutionName,
          institutionName: ba.institutionName,
          requisitionId: "",
          ownerAccountId: ctx.meAccountId,
          status: "restored",
          linkedAt: ba.createdAt,
        },
        { owner: group },
      );
      const transactions = TransactionList.create([], { owner: group });
      const created = Account.create(
        {
          name: ba.name,
          iban: ba.iban,
          currency: ba.currency,
          institutionName: ba.institutionName,
          externalId: ba.externalId,
          connection,
          transactions,
          archived: ba.archived,
          createdAt: ba.createdAt,
        },
        { owner: group },
      );
      household.accounts.$jazz.push(created);
      account = created as LoadedAccount;
      accountByExtId.set(ba.externalId, account);
      counts.accounts++;
    }

    // Build a dedupe set per-account using bank externalId.
    const existingTxIds = new Set<string>();
    for (const t of asArr<LoadedTransaction>(account.transactions)) {
      if (t) existingTxIds.add(t.externalId);
    }

    for (const bt of ba.transactions) {
      if (existingTxIds.has(bt.externalId)) continue;
      const labelsList = TransactionLabelList.create([], { owner: group });
      const suggestions = AISuggestionList.create([], { owner: group });
      const tx = Transaction.create(
        {
          externalId: bt.externalId,
          bookedAt: bt.bookedAt,
          valueDate: bt.valueDate,
          amountMinor: bt.amountMinor,
          currency: bt.currency,
          counterparty: bt.counterparty,
          description: bt.description,
          rawPayloadJson: bt.rawPayloadJson,
          accountId: account.$jazz.id,
          labels: labelsList,
          suggestions,
        },
        { owner: group },
      );
      account.transactions.$jazz.push(tx);
      existingTxIds.add(bt.externalId);
      counts.transactions++;

      for (const bl of bt.labels) {
        const label = TransactionLabel.create(
          {
            byAccountId: bl.byAccountId,
            at: bl.at,
            categoryRef: bl.categoryExternalId ? categoryByExtId.get(bl.categoryExternalId) : undefined,
            addTag: bl.addTagExternalId ? tagByExtId.get(bl.addTagExternalId) : undefined,
            removeTag: bl.removeTagExternalId ? tagByExtId.get(bl.removeTagExternalId) : undefined,
            source: bl.source,
            ruleId: bl.ruleId,
            confidence: bl.confidence,
            note: bl.note,
            revoked: bl.revoked,
          },
          { owner: group },
        );
        labelsList.$jazz.push(label);
        counts.labels++;
      }
    }
  }

  return { addedCounts: counts };
}
