import { parseRuleSpec } from "@resonable/core";
import { useAccount } from "../jazz";

export function RulesView() {
  const { me } = useAccount();
  const firstHousehold = me?.profile?.households?.[0]?.household;
  const rules = firstHousehold?.rules ?? [];

  return (
    <>
      <h2>Rules</h2>
      <p className="muted">
        Deterministic rules applied before any LLM call. User-authored rules are
        prioritized over derived ones. Disable a rule to audit its behavior.
      </p>
      {rules.length === 0 && <p className="muted">No rules yet. Rules can be authored manually or derived from clustered labeled transactions.</p>}
      {rules.map((r, i) => r ? (
        <div className="card" key={i}>
          <div className="row">
            <div>
              <strong>{r.name}</strong>
              <span className="pill">{r.source}</span>
              {!r.enabled && <span className="pill">disabled</span>}
              <div className="muted">priority {r.priority} \u2022 hit {r.hitCount}\u00d7 \u2022 confidence {(r.confidence * 100).toFixed(0)}%</div>
            </div>
          </div>
          <pre style={{ fontSize: 12, overflow: "auto", margin: 0 }}>
            {safeFormat(r.specJson)}
          </pre>
          {r.provenance && <div className="muted">{r.provenance}</div>}
        </div>
      ) : null)}
    </>
  );
}

function safeFormat(json: string): string {
  try {
    return JSON.stringify(parseRuleSpec(json), null, 2);
  } catch (err) {
    return `(invalid spec: ${(err as Error).message})\n${json}`;
  }
}
