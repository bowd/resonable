import { useMemo, useState } from "react";
import { Group } from "jazz-tools";
import {
  exportTransactionsCsv,
  runPipeline,
  type CsvExportRow,
  type LabelPlan,
  type SuggestionPlan,
} from "@resonable/core";
import { AISuggestion, Transaction } from "@resonable/schema";
import { useAccount } from "../jazz";
import { platform } from "../platform";
import {
  acceptSuggestion,
  addTagToTransaction,
  applyLabelPlan,
  applySuggestionPlan,
  bulkApplyCategory,
  effectiveCategoryId,
  effectiveTagIds,
  readAllTransactions,
  readCategories,
  readCompiledRules,
  rejectSuggestion,
  removeTagFromTransaction,
} from "../data/bindings";

type Filters = {
  query: string;
  categoryId: string;
  accountId: string;
  sign: "" | "debit" | "credit";
  from: string;
  to: string;
  tagIds: string[];
};

function matchesFilters(tx: Transaction, effectiveCat: string | undefined, f: Filters): boolean {
  if (f.categoryId === "__none__" && effectiveCat) return false;
  if (f.categoryId && f.categoryId !== "__none__" && effectiveCat !== f.categoryId) return false;
  if (f.accountId && tx.accountId !== f.accountId) return false;
  if (f.sign === "debit" && tx.amountMinor >= 0) return false;
  if (f.sign === "credit" && tx.amountMinor < 0) return false;
  if (f.from && tx.bookedAt < f.from) return false;
  if (f.to && tx.bookedAt > f.to + "T23:59:59Z") return false;
  if (f.query) {
    const q = f.query.toLowerCase();
    const hay = `${tx.counterparty ?? ""} ${tx.description}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (f.tagIds.length > 0) {
    const active = effectiveTagIds(tx);
    for (const id of f.tagIds) {
      if (!active.has(id)) return false;
    }
  }
  return true;
}

function FilterBar({
  value, onChange, categories, accounts, tags, total, shown,
}: {
  value: Filters;
  onChange: (next: Filters) => void;
  categories: { id: string; name: string }[];
  accounts: { id: string; name: string }[];
  tags: { id: string; name: string; color: string }[];
  total: number;
  shown: number;
}) {
  const set = (partial: Partial<Filters>) => onChange({ ...value, ...partial });
  const clear = () => onChange({ query: "", categoryId: "", accountId: "", sign: "", from: "", to: "", tagIds: [] });
  const active = Boolean(value.query || value.categoryId || value.accountId || value.sign || value.from || value.to || value.tagIds.length);

  return (
    <div className="card">
      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "minmax(200px, 2fr) repeat(3, minmax(120px, 1fr)) auto auto" }}>
        <input
          placeholder="Search counterparty or description"
          value={value.query}
          onChange={(e) => set({ query: e.target.value })}
        />
        <select value={value.categoryId} onChange={(e) => set({ categoryId: e.target.value })} style={{ width: "auto" }}>
          <option value="">All categories</option>
          <option value="__none__">Uncategorized</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={value.accountId} onChange={(e) => set({ accountId: e.target.value })} style={{ width: "auto" }}>
          <option value="">All accounts</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select value={value.sign} onChange={(e) => set({ sign: e.target.value as Filters["sign"] })} style={{ width: "auto" }}>
          <option value="">Any sign</option>
          <option value="debit">Debits</option>
          <option value="credit">Credits</option>
        </select>
        <input type="date" value={value.from} onChange={(e) => set({ from: e.target.value })} />
        <input type="date" value={value.to} onChange={(e) => set({ to: e.target.value })} />
      </div>
      {tags.length > 0 && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 8 }}>
          <span className="muted" style={{ fontSize: 12, alignSelf: "center" }}>Require tags:</span>
          {tags.map((t) => {
            const on = value.tagIds.includes(t.id);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => set({ tagIds: on ? value.tagIds.filter((x) => x !== t.id) : [...value.tagIds, t.id] })}
                style={{
                  fontSize: 12,
                  padding: "2px 8px",
                  borderRadius: 999,
                  background: on ? t.color : "transparent",
                  color: on ? "white" : "inherit",
                  border: `1px solid ${t.color}`,
                  cursor: "pointer",
                }}
              >
                {t.name}
              </button>
            );
          })}
        </div>
      )}
      <div className="muted" style={{ marginTop: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>{shown} of {total} transactions</span>
        {active && <button onClick={clear}>Clear filters</button>}
      </div>
    </div>
  );
}

export function TransactionsView() {
  const { me } = useAccount();
  const firstHousehold = me?.profile?.households?.[0]?.household;

  const compiled = useMemo(
    () => (firstHousehold ? readCompiledRules(firstHousehold) : []),
    [firstHousehold, firstHousehold?.rules?.length],
  );

  const categories = useMemo(
    () => (firstHousehold ? readCategories(firstHousehold) : []),
    [firstHousehold, firstHousehold?.categories?.length],
  );

  const all = useMemo(
    () => (firstHousehold ? readAllTransactions(firstHousehold) : []),
    [firstHousehold,
     firstHousehold?.accounts?.length,
     firstHousehold?.accounts?.flatMap((a) => a?.transactions?.length ?? 0).join(",")],
  );

  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({ query: "", categoryId: "", accountId: "", sign: "", from: "", to: "", tagIds: [] });
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkCategoryId, setBulkCategoryId] = useState<string>("");
  const [bulkTagIds, setBulkTagIds] = useState<string[]>([]);

  const accountChoices = useMemo(() => {
    const out: { id: string; name: string }[] = [];
    for (const a of firstHousehold?.accounts ?? []) {
      if (!a || a.archived) continue;
      out.push({ id: a.externalId, name: a.name });
    }
    return out;
  }, [firstHousehold, firstHousehold?.accounts?.length]);

  const tagChoices = useMemo(() => {
    const out: { id: string; name: string; color: string }[] = [];
    for (const t of firstHousehold?.tags ?? []) {
      if (!t || t.archived) continue;
      out.push({ id: t.id, name: t.name, color: t.color });
    }
    return out;
  }, [firstHousehold, firstHousehold?.tags?.length]);

  const filtered = useMemo(
    () => all.filter(({ tx }) => matchesFilters(tx, effectiveCategoryId(tx), filters)),
    [all, filters],
  );

  // Keep selection trimmed to ids still visible under current filters so that
  // toggling filters can't leave us acting on invisible rows.
  const visibleSelected = useMemo(() => {
    const visibleIds = new Set<string>(filtered.map(({ tx }) => tx.id as string));
    const next = new Set<string>();
    for (const id of selected) if (visibleIds.has(id)) next.add(id);
    return next;
  }, [selected, filtered]);

  const allVisibleSelected =
    filtered.length > 0 && filtered.every(({ tx }) => visibleSelected.has(tx.id));

  function toggleRow(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAllVisible(on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) for (const { tx } of filtered) next.add(tx.id);
      else for (const { tx } of filtered) next.delete(tx.id);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  function applyBulkCategory() {
    if (!firstHousehold || !me || !bulkCategoryId || visibleSelected.size === 0) return;
    const group = firstHousehold._owner.castAs(Group);
    bulkApplyCategory(
      { household: firstHousehold, meAccountId: me.id, group },
      Array.from(visibleSelected),
      bulkCategoryId,
      "user-bulk",
    );
    clearSelection();
    setBulkCategoryId("");
  }

  function applyBulkTags() {
    if (!firstHousehold || !me || bulkTagIds.length === 0 || visibleSelected.size === 0) return;
    const group = firstHousehold._owner.castAs(Group);
    const ctx = { household: firstHousehold, meAccountId: me.id, group };
    const txById = new Map<string, Transaction>();
    for (const { tx } of filtered) txById.set(tx.id, tx);
    const findTag = (id: string) => {
      for (const t of firstHousehold.tags ?? []) {
        if (t && t.id === id) return t;
      }
      return undefined;
    };
    for (const txId of visibleSelected) {
      const tx = txById.get(txId);
      if (!tx) continue;
      for (const tagId of bulkTagIds) {
        const tag = findTag(tagId);
        if (!tag) continue;
        addTagToTransaction(ctx, tx, tag);
      }
    }
    clearSelection();
    setBulkTagIds([]);
  }

  function exportSelectedCsv() {
    if (!firstHousehold || visibleSelected.size === 0) return;
    const categoryNameById = new Map<string, string>(
      categories.map((c) => [c.id as string, c.name]),
    );
    const tagNameById = new Map<string, string>();
    for (const t of firstHousehold.tags ?? []) {
      if (t) tagNameById.set(t.id as string, t.name);
    }
    const rows: CsvExportRow[] = [];
    for (const { tx, account } of filtered) {
      if (!visibleSelected.has(tx.id)) continue;
      const catId = effectiveCategoryId(tx);
      const tagIds = effectiveTagIds(tx);
      rows.push({
        bookedAt: tx.bookedAt,
        amountMinor: tx.amountMinor,
        currency: tx.currency,
        counterparty: tx.counterparty ?? undefined,
        description: tx.description,
        accountName: account.name,
        categoryName: catId ? categoryNameById.get(catId) : undefined,
        tagNames: Array.from(tagIds)
          .map((id) => tagNameById.get(id))
          .filter((n): n is string => Boolean(n)),
      });
    }
    const csv = exportTransactionsCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function runBatch() {
    if (!firstHousehold || !me) return;
    setBusy(true); setStatusMsg(null);
    try {
      const group = firstHousehold._owner.castAs(Group);
      const ctx = { household: firstHousehold, meAccountId: me.id, group };
      const toClassify = all
        .filter(({ tx }) => !effectiveCategoryId(tx))
        .map(({ pipelineInput }) => pipelineInput);
      const policy = {
        newMemberDefaultRole: firstHousehold.newMemberDefaultRole as "reader" | "writer" | "admin",
        requireAdminForRuleCreate: firstHousehold.requireAdminForRuleCreate,
        allowLLMAutoApply: firstHousehold.allowLLMAutoApply,
        autoApplyMinConfidence: firstHousehold.autoApplyMinConfidence,
      };
      const result = await runPipeline(toClassify, {
        rules: compiled,
        categories,
        policy,
        llm: platform.llm,
        maxLLMCalls: 20,
      });
      for (const plan of result.labels) applyLabelPlan(ctx, plan);
      for (const plan of result.suggestions) applySuggestionPlan(ctx, plan);
      setStatusMsg(
        `Applied ${result.labels.length} labels, ${result.suggestions.length} suggestions pending, ${result.llmFailures.length} failures.`,
      );
    } catch (err) {
      setStatusMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!firstHousehold) return <><h2>Transactions</h2><p className="muted">No household yet.</p></>;

  return (
    <>
      <h2>Transactions</h2>
      <div className="card">
        <div className="row">
          <div>
            <strong>Classify unlabeled</strong>
            <div className="muted">Applies rules first; LLM fallback for the rest. Suggestions are surfaced below.</div>
          </div>
          <button className="primary" disabled={busy || all.length === 0} onClick={runBatch}>
            {busy ? "Running\u2026" : `Run pipeline (${all.filter((x) => !effectiveCategoryId(x.tx)).length})`}
          </button>
        </div>
        {statusMsg && <p className="muted">{statusMsg}</p>}
      </div>
      <FilterBar
        value={filters}
        onChange={setFilters}
        categories={categories}
        accounts={accountChoices}
        tags={tagChoices}
        total={all.length}
        shown={filtered.length}
      />
      {visibleSelected.size > 0 && (
        <div
          className="card"
          style={{
            position: "sticky",
            top: 0,
            zIndex: 10,
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center",
          }}
        >
          <strong>{visibleSelected.size} selected</strong>
          <select
            value={bulkCategoryId}
            onChange={(e) => setBulkCategoryId(e.target.value)}
            style={{ width: "auto" }}
          >
            <option value="">Choose category\u2026</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button
            className="primary"
            disabled={!bulkCategoryId}
            onClick={applyBulkCategory}
          >
            Apply
          </button>
          <select
            multiple
            value={bulkTagIds}
            onChange={(e) =>
              setBulkTagIds(Array.from(e.target.selectedOptions).map((o) => o.value))
            }
            style={{ width: "auto", minHeight: 28 }}
          >
            {tagChoices.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <button disabled={bulkTagIds.length === 0} onClick={applyBulkTags}>
            Add tags
          </button>
          <button onClick={exportSelectedCsv}>Export selected as CSV</button>
          <button onClick={clearSelection}>Clear selection</button>
        </div>
      )}
      {all.length === 0 && <p className="muted">No transactions imported yet.</p>}
      {all.length > 0 && filtered.length === 0 && <p className="muted">No transactions match the filters.</p>}
      {filtered.length > 0 && (
        <div className="row" style={{ alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            aria-label="Select all visible"
            checked={allVisibleSelected}
            onChange={(e) => toggleAllVisible(e.target.checked)}
          />
          <span className="muted">Select all visible ({filtered.length})</span>
        </div>
      )}
      {filtered.slice(0, 200).map(({ tx, account }) => (
        <Row
          key={tx.id}
          tx={tx}
          accountName={account.name}
          categories={categories}
          effectiveId={effectiveCategoryId(tx)}
          household={firstHousehold}
          tagChoices={(firstHousehold.tags ?? []).filter((t) => t && !t.archived).map((t) => ({ id: t!.id, name: t!.name, color: t!.color }))}
          selected={visibleSelected.has(tx.id)}
          onToggleSelected={(on) => toggleRow(tx.id, on)}
        />
      ))}
      {filtered.length > 200 && (
        <p className="muted">Showing first 200 of {filtered.length}. Narrow the filters to see the rest.</p>
      )}
    </>
  );

}

function Row({
  tx, accountName, categories, effectiveId, household, tagChoices, selected, onToggleSelected,
}: {
  tx: Transaction;
  accountName: string;
  categories: { id: string; name: string }[];
  effectiveId?: string;
  household: import("@resonable/schema").Household;
  tagChoices: { id: string; name: string; color: string }[];
  selected: boolean;
  onToggleSelected: (on: boolean) => void;
}) {
  const { me } = useAccount();
  const [expanded, setExpanded] = useState(false);
  const [addingTag, setAddingTag] = useState(false);

  const pending: AISuggestion[] = [];
  for (const s of tx.suggestions ?? []) {
    if (s && s.accepted === undefined) pending.push(s);
  }

  const activeTagIds = effectiveTagIds(tx);
  const activeTags = tagChoices.filter((t) => activeTagIds.has(t.id));
  const availableTags = tagChoices.filter((t) => !activeTagIds.has(t.id));

  function setCategory(categoryId: string) {
    if (!me) return;
    const group = household._owner.castAs(Group);
    bulkApplyCategory(
      { household, meAccountId: me.id, group },
      [tx.id],
      categoryId,
      "user",
    );
  }

  function addTagById(tagId: string) {
    if (!me) return;
    const tag = (household.tags ?? []).find((t) => t?.id === tagId);
    if (!tag) return;
    const group = household._owner.castAs(Group);
    addTagToTransaction({ household, meAccountId: me.id, group }, tx, tag);
    setAddingTag(false);
  }

  function removeTagById(tagId: string) {
    if (!me) return;
    const tag = (household.tags ?? []).find((t) => t?.id === tagId);
    if (!tag) return;
    const group = household._owner.castAs(Group);
    removeTagFromTransaction({ household, meAccountId: me.id, group }, tx, tag);
  }

  return (
    <div className="row">
      <div style={{ alignSelf: "flex-start", paddingTop: 2 }}>
        <input
          type="checkbox"
          aria-label="Select transaction"
          checked={selected}
          onChange={(e) => onToggleSelected(e.target.checked)}
        />
      </div>
      <div style={{ flex: 1 }}>
        <div>
          <strong>{tx.counterparty ?? "\u2014"}</strong>
          <span className="muted" style={{ marginLeft: 8 }}>{tx.description.slice(0, 80)}</span>
          {pending.length > 0 && (
            <span className="pill" onClick={() => setExpanded((x) => !x)} style={{ cursor: "pointer" }}>
              {pending.length} suggestion{pending.length > 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className="muted">
          {new Date(tx.bookedAt).toLocaleDateString()} \u2022 {accountName}
        </div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
          {activeTags.map((t) => (
            <span
              key={t.id}
              onClick={() => removeTagById(t.id)}
              style={{
                fontSize: 11,
                padding: "2px 8px",
                borderRadius: 999,
                background: `color-mix(in srgb, ${t.color} 20%, transparent)`,
                color: t.color,
                cursor: "pointer",
              }}
              title="Click to remove"
            >
              {t.name} \u00d7
            </span>
          ))}
          {addingTag ? (
            <select
              autoFocus
              onBlur={() => setAddingTag(false)}
              onChange={(e) => e.target.value && addTagById(e.target.value)}
              style={{ width: 120, fontSize: 11, padding: "1px 4px" }}
              defaultValue=""
            >
              <option value="" disabled>add tag\u2026</option>
              {availableTags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          ) : availableTags.length > 0 ? (
            <button
              onClick={() => setAddingTag(true)}
              style={{ fontSize: 11, padding: "1px 6px", border: "1px dashed var(--border)", background: "transparent", borderRadius: 999, cursor: "pointer" }}
            >
              + tag
            </button>
          ) : null}
        </div>
        {expanded && pending.map((s, i) => (
          <SuggestionCard key={i} tx={tx} suggestion={s} meAccountId={me?.id ?? ""} />
        ))}
      </div>
      <div style={{ textAlign: "right", display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
        <div>{(tx.amountMinor / 100).toFixed(2)} {tx.currency}</div>
        <select
          value={effectiveId ?? ""}
          onChange={(e) => e.target.value && setCategory(e.target.value)}
          style={{ width: 160, fontSize: 12 }}
        >
          <option value="">(uncategorized)</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

function SuggestionCard({
  tx, suggestion, meAccountId,
}: { tx: Transaction; suggestion: AISuggestion; meAccountId: string }) {
  const group = tx._owner.castAs(Group);
  const household = group as unknown; // we don't have a direct link here; accept/reject only need the tx + suggestion
  void household;

  return (
    <div className="card" style={{ marginTop: 6 }}>
      <div className="muted" style={{ fontSize: 12 }}>
        suggested: {suggestion.suggestedCategoryRef?.name ?? "\u2014"}
        {" \u2022 "}
        confidence {(suggestion.confidence * 100).toFixed(0)}%
        {" \u2022 "}
        {suggestion.model}
      </div>
      <div style={{ marginTop: 4 }}>{suggestion.reasoning}</div>
      <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
        <button
          className="primary"
          onClick={() =>
            acceptSuggestion(
              { household: tx._owner as never, meAccountId, group },
              tx,
              suggestion,
            )
          }
        >
          Accept
        </button>
        <button onClick={() => rejectSuggestion(suggestion)}>Reject</button>
      </div>
    </div>
  );
}

export type { LabelPlan, SuggestionPlan };
