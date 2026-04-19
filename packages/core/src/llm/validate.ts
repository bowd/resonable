import type { LLMClient } from "./client";
import type { NormalizedTransaction } from "../gocardless/normalize";

export type ValidationVerdict = {
  looksValid: boolean;
  issues: string[];
  confidence: number;
};

const SYSTEM = `You audit newly-imported bank transactions for obvious data quality issues.
Flag only CLEAR problems: suspicious duplicates, implausible amounts, corrupted text, date/amount mismatches.
Return STRICT JSON: {"looksValid": boolean, "issues": string[], "confidence": number}.
Do not flag minor stylistic issues. Be conservative: say looksValid=true unless you are sure.`;

export async function validateImport(
  llm: LLMClient,
  batch: NormalizedTransaction[],
): Promise<ValidationVerdict> {
  const sample = batch
    .slice(0, 20)
    .map(
      (t) =>
        `- [${t.bookedAt}] ${(t.amountMinor / 100).toFixed(2)} ${t.currency}  ${t.counterparty ?? ""}  ${t.description.slice(0, 80)}`,
    )
    .join("\n");
  const user = `Imported batch (${batch.length} transactions, showing up to 20):\n${sample}\n\nReturn JSON only.`;

  const res = await llm.complete({
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: user },
    ],
    jsonSchema: true,
    temperature: 0,
    maxTokens: 250,
  });
  try {
    const start = res.content.indexOf("{");
    const end = res.content.lastIndexOf("}");
    const parsed = JSON.parse(res.content.slice(start, end + 1)) as Partial<ValidationVerdict>;
    return {
      looksValid: parsed.looksValid !== false,
      issues: Array.isArray(parsed.issues)
        ? parsed.issues.filter((i): i is string => typeof i === "string").slice(0, 20)
        : [],
      confidence: clamp01(Number(parsed.confidence ?? 0.5)),
    };
  } catch {
    return { looksValid: true, issues: [], confidence: 0 };
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
