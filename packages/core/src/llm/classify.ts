import type { LLMClient } from "./client";

export type ClassifyInput = {
  bookedAt: string;
  amountMinor: number;
  currency: string;
  counterparty?: string;
  description: string;
  accountName?: string;
};

export type CategoryChoice = { id: string; name: string; hint?: string };

export type ClassifyResult = {
  categoryId: string | null;
  tags: string[];
  reasoning: string;
  confidence: number;
};

const SYSTEM = `You classify bank transactions into household expense categories.
Return STRICT JSON matching: {"categoryId": string|null, "tags": string[], "confidence": number, "reasoning": string}.
- categoryId MUST be one of the provided ids or null if none fit.
- confidence is 0..1. Only use > 0.8 when the merchant is unambiguous.
- tags are short lowercase slugs, 0..5 items.
- reasoning is one sentence.`;

export async function classifyTransaction(
  llm: LLMClient,
  input: ClassifyInput,
  categories: CategoryChoice[],
): Promise<ClassifyResult> {
  const catList = categories
    .map((c) => `- ${c.id}: ${c.name}${c.hint ? ` (${c.hint})` : ""}`)
    .join("\n");
  const amount = (input.amountMinor / 100).toFixed(2);
  const user = `Categories:
${catList}

Transaction:
  date: ${input.bookedAt}
  amount: ${amount} ${input.currency}
  counterparty: ${input.counterparty ?? "(none)"}
  description: ${input.description}
  account: ${input.accountName ?? "(unknown)"}

Return JSON only.`;

  const res = await llm.complete({
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: user },
    ],
    jsonSchema: true,
    temperature: 0.1,
    maxTokens: 200,
  });

  return parseClassifyResult(res.content, categories);
}

export function parseClassifyResult(
  content: string,
  categories: CategoryChoice[],
): ClassifyResult {
  const trimmed = extractJson(content);
  const parsed = JSON.parse(trimmed) as Partial<ClassifyResult>;
  const allowedIds = new Set(categories.map((c) => c.id));
  const categoryId =
    parsed.categoryId && allowedIds.has(parsed.categoryId) ? parsed.categoryId : null;
  const tags = Array.isArray(parsed.tags)
    ? parsed.tags.filter((t): t is string => typeof t === "string").slice(0, 5)
    : [];
  const confidence = clamp01(Number(parsed.confidence ?? 0));
  const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning : "";
  return { categoryId, tags, confidence, reasoning };
}

function extractJson(s: string): string {
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("no JSON object in LLM response");
  return s.slice(start, end + 1);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
