import { useMemo, useState } from "react";
import {
  evaluate,
  parseRuleSpec,
  classifyTransaction,
  type ClassifyResult,
  type CompiledRule,
} from "@resonable/core";
import { useAccount } from "../jazz";
import { platform } from "../platform";

export function TransactionsView() {
  const { me } = useAccount();
  const firstHousehold = me?.profile?.households?.[0]?.household;

  const compiled = useMemo<CompiledRule[]>(() => {
    const rules = firstHousehold?.rules ?? [];
    const out: CompiledRule[] = [];
    for (const r of rules) {
      if (!r) continue;
      try {
        out.push({ id: r.id, priority: r.priority, enabled: r.enabled, spec: parseRuleSpec(r.specJson) });
      } catch { /* skip invalid */ }
    }
    return out;
  }, [firstHousehold?.rules]);

  if (!firstHousehold) return <><h2>Transactions</h2><p className="muted">No household yet.</p></>;

  const allTx = firstHousehold.accounts
    ?.flatMap((a) => a?.transactions?.map((t) => ({ tx: t, accountName: a?.name ?? "?" })) ?? [])
    .filter((x): x is { tx: NonNullable<typeof x.tx>; accountName: string } => Boolean(x.tx)) ?? [];

  return (
    <>
      <h2>Transactions</h2>
      <p className="muted">
        Deterministic rules are applied first. Anything uncategorized can be
        classified with the local LLM, which may in turn propose a reusable rule.
      </p>
      {allTx.length === 0 && <p className="muted">No transactions imported yet.</p>}
      {allTx.slice(0, 200).map(({ tx, accountName }) => (
        <TransactionRow
          key={tx.id}
          description={tx.description}
          counterparty={tx.counterparty ?? undefined}
          bookedAt={tx.bookedAt}
          amountMinor={tx.amountMinor}
          currency={tx.currency}
          accountId={tx.accountId}
          accountName={accountName}
          rules={compiled}
          categories={(firstHousehold.categories ?? []).filter(Boolean).map((c) => ({
            id: c!.id, name: c!.name,
          }))}
        />
      ))}
    </>
  );
}

function TransactionRow(props: {
  description: string;
  counterparty?: string;
  bookedAt: string;
  amountMinor: number;
  currency: string;
  accountId: string;
  accountName: string;
  rules: CompiledRule[];
  categories: { id: string; name: string }[];
}) {
  const match = evaluate(
    {
      bookedAt: props.bookedAt,
      amountMinor: props.amountMinor,
      currency: props.currency,
      description: props.description,
      counterparty: props.counterparty,
      accountId: props.accountId,
    },
    props.rules,
  );
  const [ai, setAi] = useState<ClassifyResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function runLLM() {
    setBusy(true);
    try {
      const res = await classifyTransaction(platform.llm, {
        bookedAt: props.bookedAt,
        amountMinor: props.amountMinor,
        currency: props.currency,
        counterparty: props.counterparty,
        description: props.description,
        accountName: props.accountName,
      }, props.categories);
      setAi(res);
    } catch (err) {
      setAi({ categoryId: null, tags: [], reasoning: (err as Error).message, confidence: 0 });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="row">
      <div>
        <div>
          <strong>{props.counterparty ?? "\u2014"}</strong>
          <span className="muted" style={{ marginLeft: 8 }}>
            {props.description.slice(0, 80)}
          </span>
        </div>
        <div className="muted">
          {new Date(props.bookedAt).toLocaleDateString()} \u2022 {props.accountName}
          {match && (
            <span className="pill">
              rule \u2192 {match.action.setCategoryId ?? match.action.addTagIds?.join(",")}
            </span>
          )}
          {ai && (
            <span className="pill">
              ai ({(ai.confidence * 100).toFixed(0)}%) \u2192 {ai.categoryId ?? "\u2014"}
            </span>
          )}
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div>{(props.amountMinor / 100).toFixed(2)} {props.currency}</div>
        {!match && (
          <button onClick={runLLM} disabled={busy} className="primary" style={{ marginTop: 4, fontSize: 12 }}>
            {busy ? "\u2026" : "Classify"}
          </button>
        )}
      </div>
    </div>
  );
}
