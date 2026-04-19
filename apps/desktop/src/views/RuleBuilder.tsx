import { useState } from "react";
import type { Condition, RuleSpec } from "@resonable/core";

export type RuleBuilderProps = {
  value: RuleSpec | null;
  onChange: (next: RuleSpec) => void;
  categories: { id: string; name: string }[];
  tags?: { id: string; name: string; color: string }[];
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function RuleBuilder({ value, onChange, categories, tags = [] }: RuleBuilderProps) {
  const spec: RuleSpec = value ?? emptySpec();
  const mode: "all" | "any" = "all" in spec.match ? "all" : "any";
  const conditions = ("all" in spec.match ? spec.match.all : spec.match.any) as Condition[];

  function setMode(next: "all" | "any") {
    onChange({ match: next === "all" ? { all: conditions } : { any: conditions }, action: spec.action });
  }

  function setConditions(next: Condition[]) {
    onChange({ match: mode === "all" ? { all: next } : { any: next }, action: spec.action });
  }

  function setAction(partial: Partial<RuleSpec["action"]>) {
    onChange({ match: spec.match, action: { ...spec.action, ...partial } });
  }

  function addCondition() {
    setConditions([...conditions, { kind: "counterpartyContains", value: "", caseInsensitive: true }]);
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
        <span>Match</span>
        <select value={mode} onChange={(e) => setMode(e.target.value as "all" | "any")} style={{ width: 80 }}>
          <option value="all">all</option>
          <option value="any">any</option>
        </select>
        <span>of</span>
      </div>
      {conditions.map((c, i) => (
        <ConditionEditor
          key={i}
          condition={c}
          onChange={(next) => setConditions(conditions.map((x, j) => j === i ? next : x))}
          onRemove={() => setConditions(conditions.filter((_, j) => j !== i))}
        />
      ))}
      <div style={{ marginTop: 8 }}>
        <button onClick={addCondition}>+ Condition</button>
      </div>
      <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
        <strong>Action</strong>
        <label>Set category</label>
        <select
          value={spec.action.setCategoryId ?? ""}
          onChange={(e) => setAction({ setCategoryId: e.target.value || undefined })}
        >
          <option value="">(none)</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {tags.length > 0 && (
          <>
            <label>Add tags</label>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {tags.map((t) => {
                const on = (spec.action.addTagIds ?? []).includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      const current = spec.action.addTagIds ?? [];
                      const next = on ? current.filter((x) => x !== t.id) : [...current, t.id];
                      setAction({ addTagIds: next.length > 0 ? next : undefined });
                    }}
                    style={{
                      fontSize: 12,
                      padding: "2px 8px",
                      borderRadius: 999,
                      background: on ? t.color : "transparent",
                      color: on ? "white" : "inherit",
                      border: `1px solid ${t.color}`,
                      cursor: "pointer",
                    }}
                  >
                    {t.name}
                  </button>
                );
              })}
            </div>
          </>
        )}
        <label>Note (optional)</label>
        <input
          value={spec.action.note ?? ""}
          onChange={(e) => setAction({ note: e.target.value || undefined })}
          placeholder="Internal note"
        />
      </div>
    </div>
  );
}

function ConditionEditor({
  condition, onChange, onRemove,
}: {
  condition: Condition;
  onChange: (next: Condition) => void;
  onRemove: () => void;
}) {
  return (
    <div className="card" style={{ marginTop: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <select
          value={condition.kind}
          onChange={(e) => onChange(defaultForKind(e.target.value as Condition["kind"]))}
          style={{ width: 200 }}
        >
          <option value="counterpartyContains">counterparty contains</option>
          <option value="counterpartyEquals">counterparty equals</option>
          <option value="merchantRegex">counterparty regex</option>
          <option value="descriptionRegex">description regex</option>
          <option value="amountRange">amount range</option>
          <option value="weekday">weekday</option>
          <option value="accountId">account id</option>
        </select>
        <button onClick={onRemove} style={{ marginLeft: "auto" }}>Remove</button>
      </div>
      <div style={{ marginTop: 8 }}>
        <KindFields condition={condition} onChange={onChange} />
      </div>
    </div>
  );
}

function KindFields({
  condition, onChange,
}: { condition: Condition; onChange: (next: Condition) => void }) {
  switch (condition.kind) {
    case "counterpartyContains":
    case "counterpartyEquals":
      return (
        <>
          <label>Value</label>
          <input
            value={condition.value}
            onChange={(e) => onChange({ ...condition, value: e.target.value })}
            placeholder="SPAR"
          />
          <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
            <input
              type="checkbox"
              checked={condition.caseInsensitive ?? false}
              onChange={(e) => onChange({ ...condition, caseInsensitive: e.target.checked })}
              style={{ width: "auto" }}
            />
            <span>case-insensitive</span>
          </label>
        </>
      );
    case "merchantRegex":
    case "descriptionRegex":
      return (
        <>
          <label>Pattern</label>
          <input
            value={condition.pattern}
            onChange={(e) => onChange({ ...condition, pattern: e.target.value })}
            placeholder="^SPAR \\d{4}$"
          />
          <label>Flags</label>
          <input
            value={condition.flags ?? ""}
            onChange={(e) => onChange({ ...condition, flags: e.target.value || undefined })}
            placeholder="i"
          />
        </>
      );
    case "amountRange":
      return (
        <>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label>Min (minor units)</label>
              <input
                type="number"
                value={condition.minMinor ?? ""}
                onChange={(e) => onChange({
                  ...condition,
                  minMinor: e.target.value ? Number(e.target.value) : undefined,
                })}
                placeholder="1000"
              />
            </div>
            <div style={{ flex: 1 }}>
              <label>Max (minor units)</label>
              <input
                type="number"
                value={condition.maxMinor ?? ""}
                onChange={(e) => onChange({
                  ...condition,
                  maxMinor: e.target.value ? Number(e.target.value) : undefined,
                })}
                placeholder="50000"
              />
            </div>
          </div>
          <label>Sign</label>
          <select
            value={condition.sign ?? ""}
            onChange={(e) => onChange({
              ...condition,
              sign: (e.target.value || undefined) as "debit" | "credit" | undefined,
            })}
          >
            <option value="">(any)</option>
            <option value="debit">debit (outgoing)</option>
            <option value="credit">credit (incoming)</option>
          </select>
          <label>Currency</label>
          <input
            value={condition.currency ?? ""}
            onChange={(e) => onChange({ ...condition, currency: e.target.value || undefined })}
            placeholder="EUR"
          />
        </>
      );
    case "weekday":
      return (
        <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
          {WEEKDAYS.map((label, i) => {
            const on = condition.days.includes(i);
            return (
              <button
                key={i}
                type="button"
                onClick={() => onChange({
                  ...condition,
                  days: on ? condition.days.filter((d) => d !== i) : [...condition.days, i],
                })}
                style={{
                  padding: "4px 8px",
                  background: on ? "var(--accent)" : "transparent",
                  color: on ? "white" : "inherit",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      );
    case "accountId":
      return (
        <>
          <label>Account id</label>
          <input
            value={condition.value}
            onChange={(e) => onChange({ ...condition, value: e.target.value })}
            placeholder="co_z..."
          />
        </>
      );
  }
}

function defaultForKind(kind: Condition["kind"]): Condition {
  switch (kind) {
    case "counterpartyContains":
    case "counterpartyEquals":
      return { kind, value: "", caseInsensitive: true };
    case "merchantRegex":
    case "descriptionRegex":
      return { kind, pattern: "", flags: "i" };
    case "amountRange":
      return { kind: "amountRange" };
    case "weekday":
      return { kind: "weekday", days: [] };
    case "accountId":
      return { kind: "accountId", value: "" };
  }
}

function emptySpec(): RuleSpec {
  return {
    match: { all: [{ kind: "counterpartyContains", value: "", caseInsensitive: true }] },
    action: {},
  };
}
