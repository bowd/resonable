import { useState } from "react";
import { Group } from "jazz-tools";
import { Category, Household } from "@resonable/schema";
import { useAccount } from "../jazz";
import {
  archiveCategory,
  createCategory,
  recolorCategory,
  renameCategory,
} from "../data/bindings";

const PALETTE = ["#16a34a", "#f97316", "#2563eb", "#a855f7", "#db2777", "#0891b2", "#059669", "#6b7280", "#dc2626", "#ea580c", "#4f46e5"];

export function CategoriesView() {
  const { me } = useAccount();
  const firstHousehold = me?.profile?.households?.[0]?.household;
  const [showArchived, setShowArchived] = useState(false);

  if (!firstHousehold) {
    return (
      <>
        <h2>Categories</h2>
        <p className="muted">No household yet.</p>
      </>
    );
  }

  const all = firstHousehold.categories ?? [];
  const visible: Category[] = [];
  for (const c of all) {
    if (!c) continue;
    if (!showArchived && c.archived) continue;
    visible.push(c);
  }

  return (
    <>
      <h2>Categories</h2>
      <p className="muted">
        Categories are shared across the household. Rules and LLM suggestions
        reference their ids; archive \u2014 don\u2019t delete \u2014 to keep historical
        labels intact.
      </p>
      <AddCategoryCard household={firstHousehold} />
      <div className="card">
        <label style={{ display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} style={{ width: "auto" }} />
          <span>Show archived</span>
        </label>
      </div>
      {visible.map((c) => <CategoryRow key={c.id} category={c} />)}
    </>
  );
}

function CategoryRow({ category }: { category: Category }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);

  function save() {
    if (name.trim() && name !== category.name) renameCategory(category, name.trim());
    setEditing(false);
  }

  return (
    <div className="row">
      <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
        <span
          style={{
            display: "inline-block",
            width: 14, height: 14, borderRadius: "50%",
            background: category.color,
          }}
        />
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
          <strong onClick={() => setEditing(true)} style={{ cursor: "text" }}>
            {category.icon ? `${category.icon} ` : ""}{category.name}
          </strong>
        )}
        {category.archived && <span className="pill">archived</span>}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <PalettePicker category={category} />
        <button onClick={() => archiveCategory(category, !category.archived)}>
          {category.archived ? "Unarchive" : "Archive"}
        </button>
      </div>
    </div>
  );
}

function PalettePicker({ category }: { category: Category }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen((o) => !o)}>Color</button>
      {open && (
        <div
          className="card"
          style={{
            position: "absolute", right: 0, top: "110%",
            display: "grid", gridTemplateColumns: "repeat(6, 20px)", gap: 4,
            padding: 8, zIndex: 10,
          }}
        >
          {PALETTE.map((c) => (
            <button
              key={c}
              style={{ width: 20, height: 20, borderRadius: 4, background: c, border: c === category.color ? "2px solid var(--fg)" : "1px solid var(--border)" }}
              onClick={() => { recolorCategory(category, c); setOpen(false); }}
              aria-label={`use ${c}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AddCategoryCard({ household }: { household: Household }) {
  const { me } = useAccount();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(PALETTE[0]!);
  const [icon, setIcon] = useState("");

  function save() {
    if (!me || !name.trim()) return;
    const group = household._owner.castAs(Group);
    createCategory(
      { household, meAccountId: me.id, group },
      { name: name.trim(), color, ...(icon.trim() ? { icon: icon.trim() } : {}) },
    );
    setName(""); setIcon(""); setAdding(false);
  }

  if (!adding) {
    return (
      <div className="card">
        <button className="primary" onClick={() => setAdding(true)}>+ New category</button>
      </div>
    );
  }

  return (
    <div className="card">
      <label>Name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Coffee" />
      <label>Icon (optional)</label>
      <input value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="\u2615" />
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
