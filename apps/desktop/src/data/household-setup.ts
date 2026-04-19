import { Group } from "jazz-tools";
import {
  AccountList,
  Category,
  CategoryList,
  Household,
  HouseholdRef,
  type HouseholdRefList,
  type LoadedHousehold,
  type ResonableAccount,
  Rule,
  RuleList,
  Tag,
  TagList,
} from "@resonable/schema";

const STARTER_TAGS: Array<{ name: string; color: string }> = [
  { name: "business",  color: "#2563eb" },
  { name: "shared",    color: "#16a34a" },
  { name: "recurring", color: "#a855f7" },
  { name: "travel",    color: "#ea580c" },
];

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

/**
 * Create a new household Group with starter categories, tags, and rules,
 * and link it from the current user's profile. Hoisted out of Household.tsx
 * so other views (e.g. Onboarding) can create households without duplicating
 * the starter seeding logic.
 *
 * Caller must have a loaded account with `profile.households` resolved.
 */
export function createHouseholdWithStarters(
  me: ResonableAccount & { profile: { households: HouseholdRefList } },
  name: string,
): LoadedHousehold {
  const group = Group.create({ owner: me });
  group.addMember("everyone", "reader");
  const accounts = AccountList.create([], { owner: group });
  const categories = CategoryList.create([], { owner: group });
  for (const c of STARTER_CATEGORIES) {
    categories.$jazz.push(
      Category.create(
        { name: c.name, color: c.color, icon: c.icon, archived: false },
        { owner: group },
      ),
    );
  }
  const tags = TagList.create([], { owner: group });
  for (const t of STARTER_TAGS) {
    tags.$jazz.push(Tag.create({ name: t.name, color: t.color, archived: false }, { owner: group }));
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
      action: { setCategoryId: cat.$jazz.id },
    };
    rules.$jazz.push(
      Rule.create(
        {
          name: r.name,
          specJson: JSON.stringify(spec),
          priority: 0,
          enabled: true,
          source: "derived",
          confidence: 0.95,
          createdByAccountId: me.$jazz.id,
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
      createdByAccountId: me.$jazz.id,
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
  const ref = HouseholdRef.create(
    { household, joinedAt: new Date().toISOString() },
    { owner: me.profile.households.$jazz.owner },
  );
  me.profile.households.$jazz.push(ref);
  return household as LoadedHousehold;
}
