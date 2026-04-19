import { useMemo, useState } from "react";
import { Group } from "jazz-tools";
import {
  runPipeline,
  type LabelPlan,
  type SuggestionPlan,
} from "@resonable/core";
import { AISuggestion, Transaction } from "@resonable/schema";
import { useAccount } from "../jazz";
import { platform } from "../platform";
import {
  acceptSuggestion,
  applyLabelPlan,
  applySuggestionPlan,
  effectiveCategoryId,
  readAllTransactions,
  readCategories,
  readCompiledRules,
  rejectSuggestion,
} from "../data/bindings";

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
      {all.length === 0 && <p className="muted">No transactions imported yet.</p>}
      {all.slice(0, 200).map(({ tx, account }) => (
        <Row
          key={tx.id}
          tx={tx}
          accountName={account.name}
          categoryName={categoryNameFor(tx)}
        />
      ))}
    </>
  );

  function categoryNameFor(tx: Transaction): string | undefined {
    const id = effectiveCategoryId(tx);
    if (!id) return undefined;
    return categories.find((c) => c.id === id)?.name;
  }
}

function Row({ tx, accountName, categoryName }: { tx: Transaction; accountName: string; categoryName?: string }) {
  const { me } = useAccount();
  const [expanded, setExpanded] = useState(false);

  const pending: AISuggestion[] = [];
  for (const s of tx.suggestions ?? []) {
    if (s && s.accepted === undefined) pending.push(s);
  }

  return (
    <div className="row">
      <div style={{ flex: 1 }}>
        <div>
          <strong>{tx.counterparty ?? "\u2014"}</strong>
          <span className="muted" style={{ marginLeft: 8 }}>{tx.description.slice(0, 80)}</span>
          {categoryName && <span className="pill">{categoryName}</span>}
          {pending.length > 0 && (
            <span className="pill" onClick={() => setExpanded((x) => !x)} style={{ cursor: "pointer" }}>
              {pending.length} suggestion{pending.length > 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className="muted">
          {new Date(tx.bookedAt).toLocaleDateString()} \u2022 {accountName}
        </div>
        {expanded && pending.map((s, i) => (
          <SuggestionCard key={i} tx={tx} suggestion={s} meAccountId={me?.id ?? ""} />
        ))}
      </div>
      <div style={{ textAlign: "right" }}>
        <div>{(tx.amountMinor / 100).toFixed(2)} {tx.currency}</div>
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
