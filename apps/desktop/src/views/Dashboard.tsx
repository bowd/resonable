import { useMemo, useState } from "react";
import {
  defaultRange,
  summarize,
  type DateRange,
  type Summary,
  type SummaryInput,
} from "@resonable/core";
import { useAccount } from "../jazz";
import { effectiveCategoryId, effectiveTagIds, readAllTransactions, readCategories } from "../data/bindings";

export function DashboardView() {
  const { me } = useAccount();
  const firstHousehold = me?.profile?.households?.[0]?.household;
  const [range, setRange] = useState<DateRange>(() => defaultRange());

  const categories = useMemo(
    () => (firstHousehold ? readCategories(firstHousehold) : []),
    [firstHousehold, firstHousehold?.categories?.length],
  );

  const tags = useMemo<{ id: string; name: string; color: string }[]>(() => {
    if (!firstHousehold) return [];
    const out: { id: string; name: string; color: string }[] = [];
    for (const tg of firstHousehold.tags ?? []) {
      if (!tg || tg.archived) continue;
      out.push({ id: tg.id, name: tg.name, color: tg.color });
    }
    return out;
  }, [firstHousehold, firstHousehold?.tags?.length]);

  const inputs: SummaryInput[] = useMemo(() => {
    if (!firstHousehold) return [];
    return readAllTransactions(firstHousehold).map(({ tx, pipelineInput }) => ({
      id: tx.id,
      bookedAt: pipelineInput.bookedAt,
      amountMinor: pipelineInput.amountMinor,
      currency: pipelineInput.currency,
      counterparty: pipelineInput.counterparty,
      accountId: pipelineInput.accountId,
      categoryId: effectiveCategoryId(tx),
      tagIds: [...effectiveTagIds(tx)],
    }));
  }, [
    firstHousehold,
    firstHousehold?.accounts?.flatMap((a) => (a?.transactions ?? []).map((t) => t?.labels?.length ?? 0).join(".")).join(","),
  ]);

  const summary = useMemo(() => summarize(inputs, range), [inputs, range]);
  const categoryName = (id: string | null) =>
    id ? categories.find((c) => c.id === id)?.name ?? `(deleted: ${id.slice(0, 6)})` : "Uncategorized";
  const tagInfo = (id: string): { name: string; color: string | null } => {
    const found = tags.find((tg) => tg.id === id);
    if (found) return { name: found.name, color: found.color };
    return { name: `(deleted: ${id.slice(0, 6)})`, color: null };
  };

  if (!firstHousehold) {
    return (
      <>
        <h2>Dashboard</h2>
        <p className="muted">No household yet.</p>
      </>
    );
  }

  return (
    <>
      <h2>Dashboard</h2>
      <p className="muted">Spend is shown in the dominant currency of the selected window. Income is separated from spend in the totals.</p>
      <RangePicker value={range} onChange={setRange} />
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        <StatCard label="Total spend" value={fmt(summary.totalSpendMinor, summary.currency)} sub={`${summary.transactionCount} tx`} />
        <StatCard label="Income" value={fmt(summary.totalIncomeMinor, summary.currency)} />
        <StatCard label="Uncategorized" value={String(summary.uncategorizedCount)} sub={summary.transactionCount > 0 ? `${Math.round((summary.uncategorizedCount / summary.transactionCount) * 100)}% of window` : undefined} />
        <StatCard label="Net" value={fmt(summary.totalIncomeMinor - summary.totalSpendMinor, summary.currency)} />
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        <strong>By category</strong>
        <CategoryBars summary={summary} categoryName={categoryName} />
      </div>
      <div className="card">
        <strong>Top merchants</strong>
        {summary.topMerchants.length === 0 && <p className="muted">No merchant data in range.</p>}
        {summary.topMerchants.map((m) => (
          <div key={m.counterparty} className="row">
            <div>{m.counterparty}<div className="muted">{m.count} tx</div></div>
            <div>{fmt(m.spendMinor, summary.currency)}</div>
          </div>
        ))}
      </div>
      <div className="card">
        <strong>By tag</strong>
        <TagBars summary={summary} tagInfo={tagInfo} />
      </div>
      <div className="card">
        <strong>Weekly spend</strong>
        <WeeklySparkline summary={summary} />
      </div>
    </>
  );
}

function RangePicker({ value, onChange }: { value: DateRange; onChange: (r: DateRange) => void }) {
  function preset(days: number) {
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 3600 * 1000);
    onChange({ from: from.toISOString(), to: to.toISOString() });
  }
  return (
    <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <button onClick={() => preset(7)}>7d</button>
      <button onClick={() => preset(30)}>30d</button>
      <button onClick={() => preset(90)}>90d</button>
      <button onClick={() => preset(365)}>365d</button>
      <span className="muted" style={{ marginLeft: 8 }}>or</span>
      <input
        type="date"
        value={value.from.slice(0, 10)}
        onChange={(e) => onChange({ ...value, from: new Date(e.target.value).toISOString() })}
      />
      <input
        type="date"
        value={value.to.slice(0, 10)}
        onChange={(e) => onChange({ ...value, to: new Date(e.target.value + "T23:59:59Z").toISOString() })}
      />
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600 }}>{value}</div>
      {sub && <div className="muted" style={{ fontSize: 12 }}>{sub}</div>}
    </div>
  );
}

function CategoryBars({ summary, categoryName }: { summary: Summary; categoryName: (id: string | null) => string }) {
  const spendRows = summary.byCategory.filter((c) => c.spendMinor > 0);
  const max = spendRows[0]?.spendMinor ?? 1;
  if (spendRows.length === 0) return <p className="muted">No spend in range.</p>;
  return (
    <div style={{ display: "grid", gap: 4, marginTop: 8 }}>
      {spendRows.map((c) => {
        const pct = Math.max(2, Math.round((c.spendMinor / max) * 100));
        return (
          <div key={c.categoryId ?? "__none__"}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span>{categoryName(c.categoryId)}</span>
              <span className="muted">{fmt(c.spendMinor, summary.currency)} \u2022 {c.count} tx</span>
            </div>
            <div style={{ height: 8, background: "var(--border)", borderRadius: 4, overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)" }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TagBars({
  summary,
  tagInfo,
}: {
  summary: Summary;
  tagInfo: (id: string) => { name: string; color: string | null };
}) {
  const spendRows = summary.byTag.filter((x) => x.spendMinor > 0);
  const max = spendRows[0]?.spendMinor ?? 1;
  if (spendRows.length === 0) return <p className="muted">No tagged spend in range.</p>;
  return (
    <div style={{ display: "grid", gap: 4, marginTop: 8 }}>
      {spendRows.map((x) => {
        const pct = Math.max(2, Math.round((x.spendMinor / max) * 100));
        const info = tagInfo(x.tagId);
        const bg = info.color ?? "var(--accent)";
        return (
          <div key={x.tagId}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span>{info.name}</span>
              <span className="muted">{fmt(x.spendMinor, summary.currency)} \u2022 {x.count} tx</span>
            </div>
            <div style={{ height: 8, background: "var(--border)", borderRadius: 4, overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: bg }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function WeeklySparkline({ summary }: { summary: Summary }) {
  if (summary.weekly.length === 0) return <p className="muted">No data.</p>;
  const max = Math.max(1, ...summary.weekly.map((w) => w.spendMinor));
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "flex-end", height: 72, marginTop: 6 }}>
      {summary.weekly.map((w) => (
        <div key={w.weekStart} style={{ flex: 1, textAlign: "center" }}>
          <div
            title={`${w.weekStart}: ${fmt(w.spendMinor, summary.currency)}`}
            style={{
              height: `${Math.round((w.spendMinor / max) * 64)}px`,
              background: "var(--accent)",
              borderRadius: 3,
              minHeight: 2,
            }}
          />
          <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>{w.weekStart.slice(5)}</div>
        </div>
      ))}
    </div>
  );
}

function fmt(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}
