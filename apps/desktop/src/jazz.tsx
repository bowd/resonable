import { DemoAuthBasicUI as RawDemoAuthBasicUI, JazzReactProvider } from "jazz-tools/react";
import type { FC, PropsWithChildren, ReactNode } from "react";
import { ResonableAccount } from "@resonable/schema";

// jazz-tools targets React 19's JSX types; cast to a React 18-compatible FC so
// the existing toolchain (React 18.3) can render it.
const DemoAuthBasicUI = RawDemoAuthBasicUI as unknown as FC<{
  appName: string;
  children?: ReactNode;
}>;

/**
 * Public Jazz Mesh sync server is used by default. It relays encrypted
 * ops only — it can't read household data, which keeps the "no central
 * authority" guarantee. Users can point `resonable.sync.peer` at a self-hosted
 * peer to avoid the default relay entirely.
 */
const defaultPeer = "wss://mesh.jazz.tools/?key=resonable@local.dev";

export function JazzApp({ children }: PropsWithChildren) {
  const peer = (typeof localStorage !== "undefined"
    && localStorage.getItem("resonable.sync.peer"))
    || defaultPeer;

  return (
    <JazzReactProvider
      sync={{ peer: peer as `wss://${string}` }}
      AccountSchema={ResonableAccount}
    >
      <DemoAuthBasicUI appName="Resonable">{children}</DemoAuthBasicUI>
    </JazzReactProvider>
  );
}

export {
  useAccount,
  useAcceptInvite,
  useCoState,
  useLogOut,
} from "jazz-tools/react";

import { useAccount as useAccountRaw } from "jazz-tools/react";
import { HouseholdLoadResolve, ResonableAccount as ResonableAccountSchema } from "@resonable/schema";
import type { LoadedAccount, LoadedHousehold } from "@resonable/schema";

/**
 * Resolve the current user's account deeply enough that household views can
 * treat all nested lists as loaded. Returns `null` while the account is
 * still loading, which mirrors the demo-auth gate above this tree.
 */
export function useCurrentAccount() {
  const me = useAccountRaw(ResonableAccountSchema, {
    resolve: {
      profile: {
        households: {
          $each: {
            household: HouseholdLoadResolve,
          },
        },
      },
    },
  });
  return me;
}

/**
 * Convenience: grab the first loaded household referenced by the current user's
 * profile. Most views only care about one household at a time.
 */
export function useFirstHousehold(): { me: unknown; household: LoadedHousehold | null } {
  const me = useCurrentAccount();
  if (!me.$isLoaded) return { me, household: null };
  const refs = me.profile.households;
  for (const ref of refs as unknown as ReadonlyArray<{ household: LoadedHousehold }>) {
    if (ref?.household) return { me, household: ref.household };
  }
  return { me, household: null };
}

export type { LoadedAccount, LoadedHousehold };
