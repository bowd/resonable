import type { Condition, Matcher, RuleInput, RuleSpec } from "./spec";

export type CompiledRule = {
  id: string;
  priority: number;
  spec: RuleSpec;
  enabled: boolean;
};

export type RuleMatch = {
  ruleId: string;
  action: RuleSpec["action"];
};

export function evaluate(input: RuleInput, rules: CompiledRule[]): RuleMatch | null {
  const ordered = [...rules]
    .filter((r) => r.enabled)
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  for (const rule of ordered) {
    if (matches(input, rule.spec.match)) {
      return { ruleId: rule.id, action: rule.spec.action };
    }
  }
  return null;
}

export function matches(input: RuleInput, matcher: Matcher): boolean {
  if ("all" in matcher) return matcher.all.every((c) => matchOne(input, c));
  return matcher.any.some((c) => matchOne(input, c));
}

function matchOne(input: RuleInput, c: Condition): boolean {
  switch (c.kind) {
    case "merchantRegex":
      return new RegExp(c.pattern, c.flags).test(input.counterparty ?? "");
    case "descriptionRegex":
      return new RegExp(c.pattern, c.flags).test(input.description);
    case "counterpartyEquals": {
      const a = input.counterparty ?? "";
      const b = c.value;
      return c.caseInsensitive ? a.toLowerCase() === b.toLowerCase() : a === b;
    }
    case "counterpartyContains": {
      const a = input.counterparty ?? "";
      const b = c.value;
      return c.caseInsensitive
        ? a.toLowerCase().includes(b.toLowerCase())
        : a.includes(b);
    }
    case "amountRange": {
      if (c.currency && c.currency !== input.currency) return false;
      const amt = input.amountMinor;
      if (c.sign === "debit" && amt >= 0) return false;
      if (c.sign === "credit" && amt < 0) return false;
      const abs = Math.abs(amt);
      if (c.minMinor !== undefined && abs < c.minMinor) return false;
      if (c.maxMinor !== undefined && abs > c.maxMinor) return false;
      return true;
    }
    case "accountId":
      return input.accountId === c.value;
    case "weekday": {
      const d = new Date(input.bookedAt).getUTCDay();
      return c.days.includes(d);
    }
  }
}
