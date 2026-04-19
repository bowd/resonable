import { useMemo, useState } from "react";
import {
  Household,
  HouseholdRef,
  ResonableAccount,
} from "@resonable/schema";
import type { Household as HouseholdT } from "@resonable/schema";
import { encodeInvite, INVITE_TTL_MS, decodeInvite } from "@resonable/core";
import { useAccount } from "../jazz";
import { createHouseholdWithStarters } from "../data/household-setup";

export function HouseholdView() {
  const me = useAccount(ResonableAccount, {
    resolve: { profile: { households: { $each: { household: true } } } },
  });
  const households = me.$isLoaded ? me.profile.households : undefined;
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState("");

  function create(name: string) {
    if (!me || !me.$isLoaded) return;
    createHouseholdWithStarters(me, name);
    setCreating(false);
  }

  async function accept(token: string) {
    if (!me.$isLoaded) return;
    try {
      const payload = decodeInvite(token.trim());
      await me.acceptInvite(payload.householdId as never, payload.secret as never, Household);
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
      {(households as unknown as ReadonlyArray<HouseholdRef> | undefined)?.map((ref, i) => ref?.$isLoaded && ref.household?.$isLoaded ? (
        <HouseholdCard key={i} household={ref.household as HouseholdT} />
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
  const group = useMemo(() => household.$jazz.owner, [household]);
  const [roleForInvite, setRoleForInvite] = useState<"reader" | "writer">("writer");
  const [lastInvite, setLastInvite] = useState<string | null>(null);

  function makeInvite() {
    const secret = group.$jazz.createInvite(roleForInvite);
    setLastInvite(
      encodeInvite({
        version: 1,
        householdId: household.$jazz.id,
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
          <div className="muted">id: {household.$jazz.id}</div>
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
