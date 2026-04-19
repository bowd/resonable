import { useMemo, useState } from "react";
import {
  parseRuleSpec,
  suggestRules,
  validateRuleSpec,
  type RuleProposal,
  type RuleSpec,
} from "@resonable/core";
import type { LoadedCategory, LoadedHousehold, LoadedRule, LoadedTag } from "@resonable/schema";
import { useCurrentAccount, useFirstHousehold } from "../jazz";
import { platform } from "../platform";
import { createRule, readLabeledTransactions } from "../data/bindings";
import { RuleBuilder } from "./RuleBuilder";

export function RulesView() {
  const { household } = useFirstHousehold();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const rules = (household?.rules as unknown as ReadonlyArray<LoadedRule> | undefined) ?? [];

  const categories = useMemo(
    () => {
      if (!household) return [];
      const out: { id: string; name: string }[] = [];
      for (const c of household.categories as unknown as ReadonlyArray<LoadedCategory>) {
        if (!c || c.archived) continue;
        out.push({ id: c.$jazz.id, name: c.name });
      }
      return out;
    },
    [household],
  );
  const tags = useMemo(
    () => {
      if (!household) return [];
      const out: { id: string; name: string; color: string }[] = [];
      for (const t of household.tags as unknown as ReadonlyArray<LoadedTag>) {
        if (!t || t.archived) continue;
        out.push({ id: t.$jazz.id, name: t.name, color: t.color });
      }
      return out;
    },
    [household],
  );

  return (
    <>
      <h2>Rules</h2>
      <p className="muted">
        Deterministic rules applied before any LLM call. User-authored rules are
        prioritized over derived ones. Disable a rule to audit its behavior.
      </p>
      {household && <SuggestPanel household={household} />}
      <div className="card">
        {adding && household ? (
          <AddRuleForm household={household} onDone={() => setAdding(false)} />
        ) : (
          <button className="primary" onClick={() => setAdding(true)}>+ Add rule</button>
        )}
      </div>
      {rules.length === 0 && <p className="muted">No rules yet.</p>}
      {rules.map((r, i) => r ? (
        <div className="card" key={i}>
          {editingId === r.$jazz.id ? (
            <EditRuleForm
              rule={r}
              categories={categories}
              tags={tags}
              onDone={() => setEditingId(null)}
            />
          ) : (
            <>
              <div className="row">
                <div>
                  <strong>{r.name}</strong>
                  <span className="pill">{r.source}</span>
                  {!r.enabled && <span className="pill">disabled</span>}
                  <div className="muted">
                    priority {r.priority} \u2022 hit {r.hitCount}\u00d7
                    \u2022 confidence {(r.confidence * 100).toFixed(0)}%
                  </div>
                  {r.lastEditedByAccountId && r.lastEditedAt && (
                    <div className="muted">
                      edited by {shortId(r.lastEditedByAccountId)} at{" "}
                      {new Date(r.lastEditedAt).toLocaleString()}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setEditingId(r.$jazz.id)}>Edit</button>
                  <button onClick={() => r.$jazz.set("enabled", !r.enabled)}>
                    {r.enabled ? "Disable" : "Enable"}
                  </button>
                </div>
              </div>
              <pre style={{ fontSize: 12, overflow: "auto", margin: 0 }}>
                {safeFormat(r.specJson)}
              </pre>
              {r.provenance && <div className="muted">{r.provenance}</div>}
            </>
          )}
        </div>
      ) : null)}
    </>
  );
}

function SuggestPanel({ household }: { household: LoadedHousehold }) {
  const me = useCurrentAccount();
  const [busy, setBusy] = useState(false);
  const [proposals, setProposals] = useState<RuleProposal[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true); setError(null);
    try {
      const labeled = readLabeledTransactions(household);
      const result = await suggestRules(labeled, {
        minSupport: 2,
        useLLM: true,
        llm: platform.llm,
        maxLLMCalls: 3,
      });
      setProposals(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function accept(p: RuleProposal) {
    if (!me.$isLoaded) return;
    const group = household.$jazz.owner;
    let categoryName = p.categoryId;
    for (const c of household.categories as unknown as ReadonlyArray<LoadedCategory>) {
      if (c?.$jazz.id === p.categoryId) { categoryName = c.name; break; }
    }
    createRule(
      { household, meAccountId: me.$jazz.id, group },
      {
        name: `Auto: ${categoryName}`,
        specJson: JSON.stringify(p.spec),
        source: p.source === "heuristic" ? "derived" : "llm",
        confidence: p.source === "llm" ? 0.7 : 0.9,
        provenance: `Derived from ${p.supportCount} labeled transactions (${p.source}).`,
      },
    );
    setProposals((prev) => prev?.filter((x) => x !== p) ?? null);
  }

  return (
    <div className="card">
      <div className="row">
        <div>
          <strong>Suggest rules from labeled transactions</strong>
          <div className="muted">Heuristic LCS proposer first; LLM fallback for categories it can\u2019t cover.</div>
        </div>
        <button className="primary" onClick={run} disabled={busy}>
          {busy ? "Thinking\u2026" : "Run"}
        </button>
      </div>
      {error && <p className="muted">{error}</p>}
      {proposals?.length === 0 && <p className="muted">No proposals. Label a few more transactions first.</p>}
      {proposals?.map((p, i) => (
        <div className="card" key={i}>
          <div className="row">
            <div>
              <strong>{categoryName(household, p.categoryId)}</strong>
              <span className="pill">{p.source}</span>
              <div className="muted">supports {p.supportCount} transactions</div>
            </div>
            <button className="primary" onClick={() => accept(p)}>Accept</button>
          </div>
          <pre style={{ fontSize: 12, overflow: "auto", margin: 0 }}>
            {JSON.stringify(p.spec, null, 2)}
          </pre>
        </div>
      ))}
    </div>
  );
}

function AddRuleForm({ household, onDone }: { household: LoadedHousehold; onDone: () => void }) {
  const me = useCurrentAccount();
  const [name, setName] = useState("");
  const [spec, setSpec] = useState<RuleSpec | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const categories: { id: string; name: string }[] = [];
  for (const c of household.categories as unknown as ReadonlyArray<LoadedCategory>) {
    if (!c || c.archived) continue;
    categories.push({ id: c.$jazz.id, name: c.name });
  }

  const tags: { id: string; name: string; color: string }[] = [];
  for (const t of household.tags as unknown as ReadonlyArray<LoadedTag>) {
    if (!t || t.archived) continue;
    tags.push({ id: t.$jazz.id, name: t.name, color: t.color });
  }

  function save() {
    if (!me.$isLoaded || !spec) return;
    setErr(null);
    try {
      validateRuleSpec(spec);
    } catch (e) {
      setErr((e as Error).message);
      return;
    }
    const group = household.$jazz.owner;
    createRule(
      { household, meAccountId: me.$jazz.id, group },
      { name: name || "Untitled", specJson: JSON.stringify(spec), source: "user" },
    );
    onDone();
  }

  return (
    <>
      <label>Name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Groceries (SPAR)" />
      <RuleBuilder value={spec} onChange={setSpec} categories={categories} tags={tags} />
      {err && <div className="muted" style={{ marginTop: 8 }}>{err}</div>}
      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        <button className="primary" onClick={save} disabled={!spec}>Save</button>
        <button onClick={onDone}>Cancel</button>
      </div>
    </>
  );
}

function EditRuleForm({
  rule,
  categories,
  tags,
  onDone,
}: {
  rule: LoadedRule;
  categories: { id: string; name: string }[];
  tags: { id: string; name: string; color: string }[];
  onDone: () => void;
}) {
  const me = useCurrentAccount();
  const [name, setName] = useState(rule.name);
  const initial = useMemo<RuleSpec | null>(() => {
    try {
      return parseRuleSpec(rule.specJson);
    } catch {
      return null;
    }
  }, [rule.specJson]);
  const [spec, setSpec] = useState<RuleSpec | null>(initial);
  const [priority, setPriority] = useState<string>(String(rule.priority));
  const [err, setErr] = useState<string | null>(null);

  function save() {
    if (!me.$isLoaded || !spec) return;
    setErr(null);
    let validated: RuleSpec;
    try {
      validated = validateRuleSpec(spec);
    } catch (e) {
      setErr((e as Error).message);
      return;
    }
    const parsedPriority = Number.parseInt(priority, 10);
    if (!Number.isFinite(parsedPriority)) {
      setErr("priority must be an integer");
      return;
    }
    rule.$jazz.set("name", name || "Untitled");
    rule.$jazz.set("specJson", JSON.stringify(validated));
    rule.$jazz.set("priority", parsedPriority);
    rule.$jazz.set("lastEditedByAccountId", me.$jazz.id);
    rule.$jazz.set("lastEditedAt", new Date().toISOString());
    onDone();
  }

  return (
    <>
      <label>Name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Groceries (SPAR)" />
      <RuleBuilder value={spec} onChange={setSpec} categories={categories} tags={tags} />
      <label>Priority</label>
      <input
        type="number"
        step={1}
        value={priority}
        onChange={(e) => setPriority(e.target.value)}
      />
      {err && <div className="muted" style={{ marginTop: 8 }}>{err}</div>}
      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        <button className="primary" onClick={save} disabled={!spec}>Save</button>
        <button onClick={onDone}>Cancel</button>
      </div>
    </>
  );
}

function categoryName(household: LoadedHousehold, id: string): string {
  for (const c of household.categories as unknown as ReadonlyArray<LoadedCategory>) {
    if (c?.$jazz.id === id) return c.name;
  }
  return id;
}

function safeFormat(json: string): string {
  try {
    return JSON.stringify(parseRuleSpec(json), null, 2);
  } catch (err) {
    return `(invalid spec: ${(err as Error).message})\n${json}`;
  }
}

function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 4)}\u2026${id.slice(-4)}` : id;
}
