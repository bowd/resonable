import { Group, co, z } from "jazz-tools";
import { Household } from "./household";

export const HouseholdRef = co.map({
  household: Household,
  joinedAt: z.string(),
  nickname: z.optional(z.string()),
});
export type HouseholdRef = co.loaded<typeof HouseholdRef>;

export const HouseholdRefList = co.list(HouseholdRef);
export type HouseholdRefList = co.loaded<typeof HouseholdRefList>;

/**
 * Per-user profile. Extends Jazz's Profile so name/inbox wiring is inherited.
 * Custom fields are user-private preferences + a list of households the user belongs to.
 */
export const UserProfile = co.profile({
  name: z.string(),
  locale: z.string(),
  preferredCurrency: z.string(),
  llmProvider: z.string(),
  llmModel: z.string(),
  llmBaseUrl: z.string(),
  households: HouseholdRefList,
});
export type UserProfile = co.loaded<typeof UserProfile>;

export const ResonableAccount = co
  .account({
    profile: UserProfile,
    root: co.map({}),
  })
  .withMigration((account, creationProps) => {
    if (!account.$jazz.has("profile")) {
      // Profile is stored under its own Group so it is world-readable (needed for
      // household member name discovery). Household refs are nested inside the
      // profile and are encrypted under the account so only the user sees them
      // until they explicitly share a household.
      const profileGroup = Group.create({ owner: account });
      profileGroup.makePublic("reader");
      const households = HouseholdRefList.create([], { owner: profileGroup });
      const profile = UserProfile.create(
        {
          name: creationProps?.name ?? "",
          locale: "en",
          preferredCurrency: "EUR",
          llmProvider: "ollama",
          llmModel: "llama3.2",
          llmBaseUrl: "http://localhost:11434",
          households,
        },
        profileGroup,
      );
      account.$jazz.set("profile", profile);
    }
    if (!account.$jazz.has("root")) {
      account.$jazz.set("root", co.map({}).create({}, { owner: account }));
    }
  });
export type ResonableAccount = co.loaded<typeof ResonableAccount>;
