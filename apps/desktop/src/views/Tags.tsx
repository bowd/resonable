import { useState } from "react";
import type { LoadedHousehold, LoadedTag } from "@resonable/schema";
import { useCurrentAccount, useFirstHousehold } from "../jazz";
import {
  archiveTag,
  createTag,
  recolorTag,
  renameTag,
} from "../data/bindings";

const PALETTE = ["#16a34a", "#f97316", "#2563eb", "#a855f7", "#db2777", "#0891b2", "#059669", "#6b7280", "#dc2626", "#ea580c", "#4f46e5"];

export function TagsView() {
  const { household } = useFirstHousehold();
  const [showArchived, setShowArchived] = useState(false);

  if (!household) {
    return (
      <>
        <h2>Tags</h2>
        <p className="muted">No household yet.</p>
      </>
    );
  }

  const visible: LoadedTag[] = [];
  for (const t of household.tags as unknown as ReadonlyArray<LoadedTag>) {
    if (!t) continue;
    if (!showArchived && t.archived) continue;
    visible.push(t);
  }

  return (
    <>
      <h2>Tags</h2>
      <p className="muted">
        Tags are append-only overlays on transactions. Each tag event (add or
        remove) is attributed to a member, so moderation can audit or revoke.
      </p>
      <AddTagCard household={household} />
      <div className="card">
        <label style={{ display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} style={{ width: "auto" }} />
          <span>Show archived</span>
        </label>
      </div>
      {visible.length === 0 && <p className="muted">No tags yet.</p>}
      {visible.map((t) => <TagRow key={t.$jazz.id} tag={t} />)}
    </>
  );
}

function TagRow({ tag }: { tag: LoadedTag }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(tag.name);

  function save() {
    if (name.trim() && name !== tag.name) renameTag(tag, name.trim());
    setEditing(false);
  }

  return (
    <div className="row">
      <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
        <span style={{ display: "inline-block", width: 14, height: 14, borderRadius: "50%", background: tag.color }} />
        {editing ? (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => e.key === "Enter" && save()}
            autoFocus
            style={{ width: 220 }}
          />
        ) : (
          <strong onClick={() => setEditing(true)} style={{ cursor: "text" }}>{tag.name}</strong>
        )}
        {tag.archived && <span className="pill">archived</span>}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <ColorPicker tag={tag} />
        <button onClick={() => archiveTag(tag, !tag.archived)}>
          {tag.archived ? "Unarchive" : "Archive"}
        </button>
      </div>
    </div>
  );
}

function ColorPicker({ tag }: { tag: LoadedTag }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen((o) => !o)}>Color</button>
      {open && (
        <div className="card" style={{ position: "absolute", right: 0, top: "110%", display: "grid", gridTemplateColumns: "repeat(6, 20px)", gap: 4, padding: 8, zIndex: 10 }}>
          {PALETTE.map((c) => (
            <button
              key={c}
              style={{ width: 20, height: 20, borderRadius: 4, background: c, border: c === tag.color ? "2px solid var(--fg)" : "1px solid var(--border)" }}
              onClick={() => { recolorTag(tag, c); setOpen(false); }}
              aria-label={`use ${c}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AddTagCard({ household }: { household: LoadedHousehold }) {
  const me = useCurrentAccount();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(PALETTE[0]!);

  function save() {
    if (!me.$isLoaded || !name.trim()) return;
    const group = household.$jazz.owner;
    createTag(
      { household, meAccountId: me.$jazz.id, group },
      { name: name.trim(), color },
    );
    setName(""); setAdding(false);
  }

  if (!adding) {
    return (
      <div className="card">
        <button className="primary" onClick={() => setAdding(true)}>+ New tag</button>
      </div>
    );
  }

  return (
    <div className="card">
      <label>Name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="business" />
      <label>Color</label>
      <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
        {PALETTE.map((c) => (
          <button
            key={c}
            style={{ width: 22, height: 22, borderRadius: 4, background: c, border: c === color ? "2px solid var(--fg)" : "1px solid var(--border)" }}
            onClick={() => setColor(c)}
            aria-label={`use ${c}`}
          />
        ))}
      </div>
      <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
        <button className="primary" disabled={!name.trim()} onClick={save}>Save</button>
        <button onClick={() => setAdding(false)}>Cancel</button>
      </div>
    </div>
  );
}
