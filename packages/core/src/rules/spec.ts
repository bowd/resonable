export type Condition =
  | { kind: "merchantRegex"; pattern: string; flags?: string }
  | { kind: "descriptionRegex"; pattern: string; flags?: string }
  | { kind: "counterpartyEquals"; value: string; caseInsensitive?: boolean }
  | { kind: "counterpartyContains"; value: string; caseInsensitive?: boolean }
  | {
      kind: "amountRange";
      currency?: string;
      minMinor?: number;
      maxMinor?: number;
      sign?: "debit" | "credit";
    }
  | { kind: "accountId"; value: string }
  | { kind: "weekday"; days: number[] };

export type Matcher =
  | { all: Condition[] }
  | { any: Condition[] };

export type Action = {
  setCategoryId?: string;
  addTagIds?: string[];
  note?: string;
};

export type RuleSpec = {
  match: Matcher;
  action: Action;
};

export type RuleInput = {
  bookedAt: string;
  amountMinor: number;
  currency: string;
  description: string;
  counterparty?: string;
  accountId: string;
};

const MAX_REGEX_LENGTH = 200;

export class InvalidRuleSpecError extends Error {}

export function parseRuleSpec(json: string): RuleSpec {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new InvalidRuleSpecError(`not valid JSON: ${(err as Error).message}`);
  }
  return validateRuleSpec(parsed);
}

export function validateRuleSpec(raw: unknown): RuleSpec {
  if (!raw || typeof raw !== "object") {
    throw new InvalidRuleSpecError("spec must be an object");
  }
  const obj = raw as Record<string, unknown>;
  const match = obj.match;
  const action = obj.action;
  if (!match || typeof match !== "object") {
    throw new InvalidRuleSpecError("match is required");
  }
  if (!action || typeof action !== "object") {
    throw new InvalidRuleSpecError("action is required");
  }

  const matcher = match as Record<string, unknown>;
  const conds = (matcher.all ?? matcher.any) as unknown;
  if (!Array.isArray(conds) || conds.length === 0) {
    throw new InvalidRuleSpecError("matcher must have non-empty all/any array");
  }
  if (conds.length > 16) {
    throw new InvalidRuleSpecError("too many conditions (max 16)");
  }
  for (const c of conds) validateCondition(c);

  const act = action as Action;
  if (!act.setCategoryId && !act.addTagIds?.length && !act.note) {
    throw new InvalidRuleSpecError("action must set at least one field");
  }
  if (act.addTagIds && act.addTagIds.length > 16) {
    throw new InvalidRuleSpecError("too many tags (max 16)");
  }
  return { match: matcher as Matcher, action: act };
}

function validateCondition(raw: unknown): asserts raw is Condition {
  if (!raw || typeof raw !== "object") {
    throw new InvalidRuleSpecError("condition must be an object");
  }
  const c = raw as Record<string, unknown>;
  switch (c.kind) {
    case "merchantRegex":
    case "descriptionRegex": {
      if (typeof c.pattern !== "string" || c.pattern.length > MAX_REGEX_LENGTH) {
        throw new InvalidRuleSpecError("regex pattern missing or too long");
      }
      try {
        new RegExp(c.pattern, typeof c.flags === "string" ? c.flags : undefined);
      } catch (err) {
        throw new InvalidRuleSpecError(`invalid regex: ${(err as Error).message}`);
      }
      return;
    }
    case "counterpartyEquals":
    case "counterpartyContains": {
      if (typeof c.value !== "string" || c.value.length === 0) {
        throw new InvalidRuleSpecError("counterparty value required");
      }
      return;
    }
    case "amountRange": {
      if (c.minMinor === undefined && c.maxMinor === undefined) {
        throw new InvalidRuleSpecError("amountRange needs min or max");
      }
      if (c.sign !== undefined && c.sign !== "debit" && c.sign !== "credit") {
        throw new InvalidRuleSpecError("sign must be debit|credit");
      }
      return;
    }
    case "accountId": {
      if (typeof c.value !== "string") {
        throw new InvalidRuleSpecError("accountId value required");
      }
      return;
    }
    case "weekday": {
      if (!Array.isArray(c.days) || c.days.some((d) => typeof d !== "number" || d < 0 || d > 6)) {
        throw new InvalidRuleSpecError("weekday days must be 0..6");
      }
      return;
    }
    default:
      throw new InvalidRuleSpecError(`unknown condition kind: ${String(c.kind)}`);
  }
}
