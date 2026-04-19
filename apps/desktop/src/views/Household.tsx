import { useMemo, useState } from "react";
import type { Group } from "jazz-tools";
import {
  Household,
  HouseholdRef,
  ResonableAccount,
} from "@resonable/schema";
import type { Household as HouseholdT } from "@resonable/schema";
import { encodeInvite, INVITE_TTL_MS, decodeInvite } from "@resonable/core";
import { useAccount } from "../jazz";
import { createHouseholdWithStarters } from "../data/household-setup";

type MemberRole = "reader" | "writer" | "admin";

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
        <HouseholdCard
          key={i}
          household={ref.household as HouseholdT}
          me={me.$isLoaded ? me : null}
        />
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

function HouseholdCard({
  household,
  me,
}: {
  household: Household;
  me: ResonableAccount | null;
}) {
  const group = useMemo(() => household.$jazz.owner, [household]);
  const [roleForInvite, setRoleForInvite] = useState<"reader" | "writer">("writer");
  const [lastInvite, setLastInvite] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(household.name);

  const myRole = group.myRole();
  const isAdmin = myRole === "admin";

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

  function saveName() {
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== household.name) {
      household.$jazz.set("name", trimmed);
    } else {
      setNameDraft(household.name);
    }
    setEditingName(false);
  }

  function cancelEditName() {
    setNameDraft(household.name);
    setEditingName(false);
  }

  return (
    <div className="card">
      <div className="row">
        <div style={{ flex: 1 }}>
          {editingName ? (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveName();
                  if (e.key === "Escape") cancelEditName();
                }}
                autoFocus
                style={{ maxWidth: 280 }}
              />
              <button className="primary" style={{ fontSize: 12 }} onClick={saveName}>Save</button>
              <button style={{ fontSize: 12 }} onClick={cancelEditName}>Cancel</button>
            </div>
          ) : (
            <>
              <strong
                onClick={() => { setNameDraft(household.name); setEditingName(true); }}
                title="Click to rename"
                style={{ cursor: "pointer" }}
              >
                {household.name}
              </strong>
              <span className="pill">{myRole ?? "member"}</span>
              <div className="muted">id: {household.$jazz.id}</div>
            </>
          )}
        </div>
      </div>
      <MembersCard group={group} me={me} isAdmin={isAdmin} />
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
      <LeaveHouseholdZone group={group} me={me} isAdmin={isAdmin} />
    </div>
  );
}

function MembersCard({
  group,
  me,
  isAdmin,
}: {
  group: Group;
  me: ResonableAccount | null;
  isAdmin: boolean;
}) {
  // `group.members` is derived from the underlying RawGroup keyset \u2014 read it
  // fresh on each render. Jazz reactivity re-renders this card when the
  // parent household / owner group re-resolves.
  const members = (() => {
    try {
      return group.members;
    } catch {
      return [];
    }
  })();

  function handleChangeRole(accountRef: unknown, newRole: MemberRole) {
    try {
      // In Jazz 0.20, addMember also updates role in-place for existing members.
      (group as unknown as { addMember: (acc: unknown, role: MemberRole) => void }).addMember(
        accountRef,
        newRole,
      );
    } catch (err) {
      alert(`Failed to change role: ${(err as Error).message}`);
    }
  }

  function handleRemove(accountRef: unknown, shortId: string) {
    if (!confirm(`Remove member ${shortId} from this household?`)) return;
    try {
      (group as unknown as { removeMember: (acc: unknown) => void }).removeMember(accountRef);
    } catch (err) {
      alert(`Failed to remove: ${(err as Error).message}`);
    }
  }

  const myId = me?.$jazz.id;

  return (
    <div style={{ marginTop: 12, marginBottom: 12 }}>
      <label style={{ marginTop: 0 }}>Members ({members.length})</label>
      {members.length === 0 ? (
        <div className="muted">No members visible.</div>
      ) : (
        <div style={{ border: "1px solid var(--border)", borderRadius: 6 }}>
          {members.map((m, i) => {
            const shortId = m.id.slice(0, 6);
            const isSelf = myId === m.id;
            const account = m.account as unknown as {
              profile?: { name?: string } | null;
            } | undefined;
            const displayName = account?.profile?.name;
            return (
              <div
                key={m.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 10px",
                  borderTop: i === 0 ? 0 : "1px solid var(--border)",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: 13 }}>
                    {displayName ?? shortId}
                    {isSelf && <span className="muted" style={{ marginLeft: 6 }}>(you)</span>}
                  </strong>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {shortId}
                    {displayName ? " \u2022 " : " "}
                    {m.role}
                  </div>
                </div>
                {isAdmin && !isSelf ? (
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <select
                      value={m.role}
                      onChange={(e) => handleChangeRole(m.account, e.target.value as MemberRole)}
                      style={{ width: 100, fontSize: 12 }}
                    >
                      <option value="reader">reader</option>
                      <option value="writer">writer</option>
                      <option value="admin">admin</option>
                    </select>
                    <button
                      style={{ fontSize: 12 }}
                      onClick={() => handleRemove(m.account, shortId)}
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <span className="pill" style={{ marginLeft: 0 }}>{m.role}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LeaveHouseholdZone({
  group,
  me,
  isAdmin,
}: {
  group: Group;
  me: ResonableAccount | null;
  isAdmin: boolean;
}) {
  const [busy, setBusy] = useState(false);

  // A household must retain at least one admin. If I'm the only admin, leaving
  // would orphan the household \u2014 so disable the button until I promote someone.
  const soleAdmin = (() => {
    if (!isAdmin) return false;
    try {
      const admins = group.members.filter((m) => m.role === "admin");
      return admins.length <= 1;
    } catch {
      return false;
    }
  })();

  async function leave() {
    if (!me || !me.$isLoaded) return;
    if (!confirm("Leave this household? You will lose access to its shared data.")) return;
    setBusy(true);
    try {
      (group as unknown as { removeMember: (acc: unknown) => void }).removeMember(me);
      // Drop the local HouseholdRef so the card disappears from this user's list.
      const profile = me.profile as unknown as { households?: unknown } | null | undefined;
      const refs = profile?.households as {
        length: number;
        [i: number]: { household?: { $jazz?: { id?: string } } } | null | undefined;
        $jazz: { remove: (i: number) => void };
      } | undefined;
      if (refs) {
        const householdId = (group as unknown as { $jazz: { id: string } }).$jazz.id;
        for (let i = refs.length - 1; i >= 0; i--) {
          const ref = refs[i];
          if (ref?.household?.$jazz?.id === householdId) {
            refs.$jazz.remove(i);
          }
        }
      }
    } catch (err) {
      alert(`Failed to leave: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        marginTop: 16,
        paddingTop: 12,
        borderTop: "1px dashed var(--border)",
      }}
    >
      <div className="muted" style={{ marginBottom: 6 }}>Danger zone</div>
      <button
        onClick={leave}
        disabled={busy || soleAdmin}
        style={{ fontSize: 12 }}
        title={soleAdmin ? "You are the only admin \u2014 promote someone else before leaving." : ""}
      >
        {busy ? "leaving\u2026" : "Leave household"}
      </button>
      {soleAdmin && (
        <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
          promote another admin first
        </span>
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
