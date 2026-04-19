import { useMemo, useState } from "react";
import { Group } from "jazz-tools";
import {
  clusterByMerchant,
  labelCluster,
  type Cluster,
  type ClusterItem,
} from "@resonable/core";
import { Household } from "@resonable/schema";
import { useAccount } from "../jazz";
import { platform } from "../platform";
import {
  bulkApplyCategory,
  effectiveCategoryId,
  readAllTransactions,
  readCategories,
} from "../data/bindings";

export function ClustersView() {
  const { me } = useAccount();
  const firstHousehold = me?.profile?.households?.[0]?.household;

  const categories = useMemo(
    () => (firstHousehold ? readCategories(firstHousehold) : []),
    [firstHousehold, firstHousehold?.categories?.length],
  );

  const clusters = useMemo<Cluster[]>(() => {
    if (!firstHousehold) return [];
    const unlabeled: ClusterItem[] = [];
    for (const { tx, pipelineInput } of readAllTransactions(firstHousehold)) {
      if (effectiveCategoryId(tx)) continue;
      unlabeled.push({
        id: tx.id,
        counterparty: pipelineInput.counterparty,
        description: pipelineInput.description,
        amountMinor: pipelineInput.amountMinor,
        currency: pipelineInput.currency,
        bookedAt: pipelineInput.bookedAt,
        accountId: pipelineInput.accountId,
      });
    }
    return clusterByMerchant(unlabeled);
  }, [
    firstHousehold,
    firstHousehold?.accounts?.flatMap((a) => a?.transactions?.length ?? 0).join(","),
    firstHousehold?.accounts?.flatMap((a) =>
      (a?.transactions ?? []).map((t) => t?.labels?.length ?? 0).join("."),
    ).join(","),
  ]);

  if (!firstHousehold) {
    return (
      <>
        <h2>Clusters</h2>
        <p className="muted">No household yet.</p>
      </>
    );
  }

  return (
    <>
      <h2>Clusters</h2>
      <p className="muted">
        Unlabeled transactions grouped by merchant. Label a cluster once; rule
        suggestions then have enough support to generalize for future imports.
      </p>
      {clusters.length === 0 && <p className="muted">Nothing to cluster. Either everything is labeled or there are no recurring merchants.</p>}
      {clusters.map((c) => (
        <ClusterCard
          key={c.key}
          cluster={c}
          household={firstHousehold}
          categories={categories}
          meAccountId={me?.id ?? ""}
        />
      ))}
    </>
  );
}

function ClusterCard({
  cluster, household, categories, meAccountId,
}: {
  cluster: Cluster;
  household: Household;
  categories: { id: string; name: string }[];
  meAccountId: string;
}) {
  const [categoryId, setCategoryId] = useState<string>(categories[0]?.id ?? "");
  const [applied, setApplied] = useState<number | null>(null);
  const [aiLabel, setAiLabel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function runLabel() {
    setBusy(true);
    try {
      const label = await labelCluster(platform.llm, cluster);
      setAiLabel(label);
    } catch (err) {
      setAiLabel(`(LLM error: ${(err as Error).message})`);
    } finally {
      setBusy(false);
    }
  }

  function apply() {
    if (!categoryId) return;
    const group = household._owner.castAs(Group);
    const n = bulkApplyCategory(
      { household, meAccountId, group },
      cluster.members.map((m) => m.id),
      categoryId,
    );
    setApplied(n);
  }

  return (
    <div className="card">
      <div className="row">
        <div>
          <strong>{cluster.label}</strong>
          <span className="pill">{cluster.members.length} tx</span>
          {aiLabel && <span className="pill">ai: {aiLabel}</span>}
        </div>
        <button onClick={runLabel} disabled={busy}>
          {busy ? "\u2026" : "Suggest label"}
        </button>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
        {cluster.members.slice(0, 4).map((m) => (
          <div key={m.id}>
            {(m.amountMinor / 100).toFixed(2)} {m.currency} \u2022 {m.description.slice(0, 80)}
          </div>
        ))}
        {cluster.members.length > 4 && <div>\u2026 and {cluster.members.length - 4} more</div>}
      </div>
      <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          style={{ width: 200 }}
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <button className="primary" disabled={!categoryId || applied !== null} onClick={apply}>
          {applied !== null ? `Applied (${applied})` : `Apply to ${cluster.members.length}`}
        </button>
      </div>
    </div>
  );
}
