import type { LLMClient } from "./client";
import type { LabeledExample } from "../rules/learn";

export type ClusterItem = {
  id: string;
  counterparty?: string;
  description: string;
  amountMinor: number;
  currency: string;
  bookedAt: string;
  accountId: string;
  categoryId?: string;
};

export type Cluster = {
  key: string;
  label: string;
  members: ClusterItem[];
  suggestedCategoryId?: string;
  suggestedTags?: string[];
};

/**
 * Cluster unlabeled transactions by counterparty + amount bucket.
 * Deterministic first pass; LLM is used to label clusters, not to group them
 * (groups of ~3 same-merchant txs don't need a model).
 */
export function clusterByMerchant(items: ClusterItem[]): Cluster[] {
  const groups = new Map<string, ClusterItem[]>();
  for (const item of items) {
    const key = merchantKey(item);
    const bucket = groups.get(key) ?? [];
    bucket.push(item);
    groups.set(key, bucket);
  }
  const out: Cluster[] = [];
  for (const [key, members] of groups) {
    if (members.length < 2) continue;
    const label = members[0]!.counterparty ?? key;
    out.push({ key, label, members });
  }
  return out.sort((a, b) => b.members.length - a.members.length);
}

export function asLabeledExamples(items: ClusterItem[]): LabeledExample[] {
  return items
    .filter((i): i is ClusterItem & { categoryId: string } => Boolean(i.categoryId))
    .map((i) => ({
      bookedAt: i.bookedAt,
      amountMinor: i.amountMinor,
      currency: i.currency,
      description: i.description,
      counterparty: i.counterparty,
      accountId: i.accountId,
      categoryId: i.categoryId,
    }));
}

function merchantKey(item: ClusterItem): string {
  const name = (item.counterparty ?? "unknown")
    .toLowerCase()
    .replace(/\d+/g, "#")
    .replace(/[^a-z0-9# ]+/g, "")
    .trim()
    .slice(0, 48);
  return `${name}|${item.currency}`;
}

const CLUSTER_LABEL_SYSTEM = `You label clusters of similar bank transactions with one short human-readable name (<=24 chars). Return STRICT JSON: {"label": string}.`;

export async function labelCluster(
  llm: LLMClient,
  cluster: Cluster,
): Promise<string> {
  const sample = cluster.members.slice(0, 5)
    .map((m) => `- ${(m.amountMinor / 100).toFixed(2)} ${m.currency}  ${m.counterparty ?? ""}  ${m.description.slice(0, 80)}`)
    .join("\n");
  const res = await llm.complete({
    messages: [
      { role: "system", content: CLUSTER_LABEL_SYSTEM },
      { role: "user", content: `Cluster (${cluster.members.length} transactions):\n${sample}\n\nReturn JSON only.` },
    ],
    jsonSchema: true,
    temperature: 0.2,
    maxTokens: 60,
  });
  try {
    const start = res.content.indexOf("{");
    const end = res.content.lastIndexOf("}");
    const obj = JSON.parse(res.content.slice(start, end + 1)) as { label?: unknown };
    if (typeof obj.label === "string" && obj.label.trim()) return obj.label.trim().slice(0, 24);
  } catch {}
  return cluster.label;
}
