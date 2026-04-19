import { Account, CoList, CoMap, Profile, co } from "jazz-tools";
import { Household } from "./household";

export class HouseholdRef extends CoMap {
  household = co.ref(Household);
  joinedAt = co.string;
  nickname = co.optional.string;
}

export class HouseholdRefList extends CoList.Of(co.ref(HouseholdRef)) {}

/**
 * Per-user profile. Extends Jazz's Profile so name/inbox wiring is inherited.
 * Custom fields are user-private preferences + a list of households the user belongs to.
 */
export class UserProfile extends Profile {
  locale = co.string;
  preferredCurrency = co.string;
  llmProvider = co.string;
  llmModel = co.string;
  llmBaseUrl = co.string;
  households = co.ref(HouseholdRefList);
}

export class ResonableAccount extends Account {
  profile = co.ref(UserProfile);
}
