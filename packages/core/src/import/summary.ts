export type SummaryInput = {
  id: string;
  bookedAt: string;
  amountMinor: number;
  currency: string;
  counterparty?: string;
  accountId?: string;
  categoryId?: string;
};

export type DateRange = { from: string; to: string };

export type Summary = {
  currency: string;
  totalSpendMinor: number;
  totalIncomeMinor: number;
  transactionCount: number;
  byCategory: Array<{ categoryId: string | null; spendMinor: number; count: number }>;
  topMerchants: Array<{ counterparty: string; spendMinor: number; count: number }>;
  weekly: Array<{ weekStart: string; spendMinor: number; incomeMinor: number }>;
  uncategorizedCount: number;
};

/**
 * Aggregate transactions into the shape the Dashboard renders.
 * Ignores transactions outside the range or in a different currency from the
 * dominant currency (reporting a mixed-currency total would be misleading).
 */
export function summarize(
  transactions: SummaryInput[],
  range: DateRange,
  opts: { currency?: string; topMerchantLimit?: number } = {},
): Summary {
  const inRange = transactions.filter((t) => t.bookedAt >= range.from && t.bookedAt <= range.to);
  const currency = opts.currency ?? dominantCurrency(inRange) ?? "EUR";
  const scoped = inRange.filter((t) => t.currency === currency);

  let totalSpendMinor = 0;
  let totalIncomeMinor = 0;
  const byCategoryMap = new Map<string | null, { spendMinor: number; count: number }>();
  const byMerchantMap = new Map<string, { spendMinor: number; count: number }>();
  const byWeekMap = new Map<string, { spendMinor: number; incomeMinor: number }>();
  let uncategorizedCount = 0;

  for (const t of scoped) {
    if (t.amountMinor < 0) totalSpendMinor += -t.amountMinor;
    else totalIncomeMinor += t.amountMinor;

    const catKey = t.categoryId ?? null;
    const cat = byCategoryMap.get(catKey) ?? { spendMinor: 0, count: 0 };
    cat.spendMinor += t.amountMinor < 0 ? -t.amountMinor : 0;
    cat.count += 1;
    byCategoryMap.set(catKey, cat);
    if (!t.categoryId) uncategorizedCount++;

    if (t.amountMinor < 0 && t.counterparty) {
      const key = t.counterparty.trim();
      if (key) {
        const m = byMerchantMap.get(key) ?? { spendMinor: 0, count: 0 };
        m.spendMinor += -t.amountMinor;
        m.count += 1;
        byMerchantMap.set(key, m);
      }
    }

    const weekStart = startOfISOWeek(t.bookedAt);
    const w = byWeekMap.get(weekStart) ?? { spendMinor: 0, incomeMinor: 0 };
    if (t.amountMinor < 0) w.spendMinor += -t.amountMinor;
    else w.incomeMinor += t.amountMinor;
    byWeekMap.set(weekStart, w);
  }

  const byCategory = [...byCategoryMap.entries()]
    .map(([categoryId, v]) => ({ categoryId, ...v }))
    .sort((a, b) => b.spendMinor - a.spendMinor);

  const topMerchants = [...byMerchantMap.entries()]
    .map(([counterparty, v]) => ({ counterparty, ...v }))
    .sort((a, b) => b.spendMinor - a.spendMinor)
    .slice(0, opts.topMerchantLimit ?? 8);

  const weekly = [...byWeekMap.entries()]
    .map(([weekStart, v]) => ({ weekStart, ...v }))
    .sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));

  return {
    currency,
    totalSpendMinor,
    totalIncomeMinor,
    transactionCount: scoped.length,
    byCategory,
    topMerchants,
    weekly,
    uncategorizedCount,
  };
}

export function defaultRange(now: Date = new Date()): DateRange {
  const to = now.toISOString();
  const from = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString();
  return { from, to };
}

function dominantCurrency(txs: SummaryInput[]): string | undefined {
  const counts = new Map<string, number>();
  for (const t of txs) counts.set(t.currency, (counts.get(t.currency) ?? 0) + 1);
  let best: string | undefined;
  let bestN = -1;
  for (const [c, n] of counts) if (n > bestN) { best = c; bestN = n; }
  return best;
}

function startOfISOWeek(iso: string): string {
  const d = new Date(iso);
  const day = d.getUTCDay() || 7;
  if (day !== 1) d.setUTCDate(d.getUTCDate() - (day - 1));
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}
