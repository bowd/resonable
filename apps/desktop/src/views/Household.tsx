import { useMemo, useState } from "react";
import { Group } from "jazz-tools";
import {
  AccountList,
  Category,
  CategoryList,
  Household,
  Rule,
  RuleList,
  Tag,
  TagList,
} from "@resonable/schema";
import { encodeInvite, INVITE_TTL_MS, decodeInvite } from "@resonable/core";
import { useAccount } from "../jazz";

const STARTER_TAGS: Array<{ name: string; color: string }> = [
  { name: "business",  color: "#2563eb" },
  { name: "shared",    color: "#16a34a" },
  { name: "recurring", color: "#a855f7" },
  { name: "travel",    color: "#ea580c" },
];

/**
 * Starter rules reference the matching starter category by name, resolved to the
 * newly-minted Category id at seed time. Kept conservative: merchants only, no
 * regex, no amount constraints \u2014 so they generalize without false positives.
 */
const STARTER_RULES: Array<{ name: string; categoryName: string; contains: string[] }> = [
  { name: "Streaming subscriptions", categoryName: "Subscriptions", contains: ["netflix", "spotify", "disney", "apple tv", "hbo max", "youtube premium"] },
  { name: "Amazon shopping",          categoryName: "Shopping",      contains: ["amazon"] },
  { name: "Ride-hailing",              categoryName: "Transport",     contains: ["uber", "bolt.eu", "freenow", "taxi"] },
];

const STARTER_CATEGORIES: Array<{ name: string; color: string; icon?: string }> = [
  { name: "Groceries",     color: "#16a34a", icon: "\ud83d\uded2" },
  { name: "Dining out",    color: "#f97316", icon: "\ud83c\udf7d" },
  { name: "Transport",     color: "#2563eb", icon: "\ud83d\ude8d" },
  { name: "Subscriptions", color: "#a855f7", icon: "\ud83d\udd01" },
  { name: "Shopping",      color: "#db2777", icon: "\ud83d\udecd" },
  { name: "Rent & utils",  color: "#0891b2", icon: "\ud83c\udfe0" },
  { name: "Income",        color: "#059669", icon: "\ud83d\udcb0" },
  { name: "Other",         color: "#6b7280" },
];

export function HouseholdView() {
  const { me } = useAccount();
  const households = me?.profile?.households;
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState("");

  function create(name: string) {
    if (!me) return;
    const group = Group.create({ owner: me });
    group.addMember("everyone", "reader");
    const accounts = AccountList.create([], { owner: group });
    const categories = CategoryList.create([], { owner: group });
    for (const c of STARTER_CATEGORIES) {
      categories.push(
        Category.create(
          { name: c.name, color: c.color, icon: c.icon, archived: false },
          { owner: group },
        ),
      );
    }
    const tags = TagList.create([], { owner: group });
    for (const t of STARTER_TAGS) {
      tags.push(Tag.create({ name: t.name, color: t.color, archived: false }, { owner: group }));
    }
    const categoryByName = new Map<string, Category>();
    for (const c of categories) if (c) categoryByName.set(c.name, c);
    const rules = RuleList.create([], { owner: group });
    for (const r of STARTER_RULES) {
      const cat = categoryByName.get(r.categoryName);
      if (!cat) continue;
      const conditions = r.contains.map((value) => ({
        kind: "counterpartyContains" as const,
        value,
        caseInsensitive: true,
      }));
      const spec = {
        match: { any: conditions },
        action: { setCategoryId: cat.id },
      };
      rules.push(
        Rule.create(
          {
            name: r.name,
            specJson: JSON.stringify(spec),
            priority: 0,
            enabled: true,
            source: "derived",
            confidence: 0.95,
            createdByAccountId: me.id,
            createdAt: new Date().toISOString(),
            hitCount: 0,
            provenance: "Seeded on household creation.",
          },
          { owner: group },
        ),
      );
    }
    const household = Household.create(
      {
        name,
        createdAt: new Date().toISOString(),
        createdByAccountId: me.id,
        accounts,
        categories,
        tags,
        rules,
        newMemberDefaultRole: "reader",
        requireAdminForRuleCreate: true,
        allowLLMAutoApply: false,
        autoApplyMinConfidence: 0.9,
      },
      { owner: group },
    );
    me.profile?.households?.push(
      // @ts-expect-error \u2014 HouseholdRef created inline
      { household, joinedAt: new Date().toISOString() },
    );
    setCreating(false);
  }

  async function accept(token: string) {
    try {
      const payload = decodeInvite(token.trim());
      await me?.acceptInvite(payload.householdId as never, payload.secret as never, Household);
      setJoining("");
    } catch (err) {
      alert((err as Error).message);
    }
  }

  return (
    <>
      <h2>Households</h2>
      <p className="muted">
        A household is a Jazz Group. Members see shared accounts and transactions;
        permissions (reader / writer / admin) control who can label and add rules.
      </p>
      {households?.map((ref, i) => ref?.household ? (
        <HouseholdCard key={i} household={ref.household} />
      ) : null)}
      <div className="card">
        {creating ? (
          <CreateForm onCreate={create} onCancel={() => setCreating(false)} />
        ) : (
          <button className="primary" onClick={() => setCreating(true)}>
            + New household
          </button>
        )}
      </div>
      <div className="card">
        <label>Accept an invite</label>
        <input
          placeholder="resonable-invite:..."
          value={joining}
          onChange={(e) => setJoining(e.target.value)}
        />
        <div style={{ marginTop: 8 }}>
          <button className="primary" disabled={!joining} onClick={() => accept(joining)}>
            Join
          </button>
        </div>
      </div>
    </>
  );
}

function HouseholdCard({ household }: { household: Household }) {
  const group = useMemo(() => household._owner.castAs(Group), [household]);
  const [roleForInvite, setRoleForInvite] = useState<"reader" | "writer">("writer");
  const [lastInvite, setLastInvite] = useState<string | null>(null);

  function makeInvite() {
    const secret = group._raw.createInvite(roleForInvite);
    setLastInvite(
      encodeInvite({
        version: 1,
        householdId: household.id,
        role: roleForInvite,
        secret,
        expiresAt: Date.now() + INVITE_TTL_MS,
      }),
    );
  }

  return (
    <div className="card">
      <div className="row">
        <div>
          <strong>{household.name}</strong>
          <span className="pill">{group.myRole() ?? "member"}</span>
          <div className="muted">id: {household.id}</div>
        </div>
      </div>
      <label>Invite a housemate</label>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <select
          value={roleForInvite}
          onChange={(e) => setRoleForInvite(e.target.value as "reader" | "writer")}
          style={{ width: 120 }}
        >
          <option value="reader">reader</option>
          <option value="writer">writer</option>
        </select>
        <button className="primary" onClick={makeInvite}>Generate invite</button>
      </div>
      {lastInvite && (
        <div style={{ marginTop: 8 }}>
          <div className="muted">Share this with the new member (expires in 7 days)</div>
          <textarea readOnly value={lastInvite} rows={3} />
        </div>
      )}
    </div>
  );
}

function CreateForm({
  onCreate, onCancel,
}: { onCreate: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  return (
    <>
      <label>Household name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Our flat" />
      <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
        <button className="primary" disabled={!name} onClick={() => onCreate(name)}>Create</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </>
  );
}
