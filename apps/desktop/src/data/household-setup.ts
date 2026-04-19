import { Group } from "jazz-tools";
import {
  AccountList,
  Category,
  CategoryList,
  Household,
  HouseholdRef,
  Rule,
  RuleList,
  Tag,
  TagList,
} from "@resonable/schema";
import type {
  Household as HouseholdT,
  HouseholdRefList,
  ResonableAccount,
} from "@resonable/schema";

/**
 * Seed tags for a new household. Small on purpose so a first-run user isn't
 * overwhelmed; they can archive or add more from the Tags view.
 */
const STARTER_TAGS: Array<{ name: string; color: string }> = [
  { name: "business",  color: "#2563eb" },
  { name: "shared",    color: "#16a34a" },
  { name: "recurring", color: "#a855f7" },
  { name: "travel",    color: "#ea580c" },
];

/**
 * Starter rules reference their category by name and are resolved to the
 * newly-minted Category id at seed time. Kept conservative: merchants only, no
 * regex, no amount constraints, so they generalize without false positives.
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

/**
 * Shape expected for the currently-authenticated user: the profile and its
 * households list must both be resolved so we can push a HouseholdRef. This
 * narrowing isn't trivially expressible in TS when starting from bare
 * `ResonableAccount`, so callers hold a `me` that came from `useAccount(..)`
 * or `useCurrentAccount()` (both already resolve `profile.households`) and we
 * re-check `$isLoaded` at runtime.
 */
type MeWithHouseholds = ResonableAccount;

/**
 * Create a household with starter categories, tags, and conservative rules,
 * then attach a HouseholdRef to the current user's profile so
 * `useFirstHousehold` finds it. Single source of truth for "new household"
 * seeding shared between Household.tsx and the first-run Onboarding flow.
 *
 * Throws if `me` isn't fully loaded yet — callers should gate on
 * `me.$isLoaded` before invoking. Returns the created Household.
 */
export function createHouseholdWithStarters(
  me: MeWithHouseholds,
  name: string,
): HouseholdT {
  if (!me.$isLoaded) throw new Error("createHouseholdWithStarters: account not loaded");
  const profile = me.profile;
  if (!profile || !profile.$isLoaded) {
    throw new Error("createHouseholdWithStarters: profile not loaded");
  }
  const households = profile.households as HouseholdRefList;
  if (!households || !households.$isLoaded) {
    throw new Error("createHouseholdWithStarters: profile.households not loaded");
  }

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
    tags.$jazz.push(
      Tag.create({ name: t.name, color: t.color, archived: false }, { owner: group }),
    );
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
    { owner: households.$jazz.owner },
  );
  households.$jazz.push(ref);

  return household;
}
