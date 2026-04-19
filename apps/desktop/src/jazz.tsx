import { createJazzReactApp, DemoAuthBasicUI, useDemoAuth } from "jazz-react";
import type { PropsWithChildren } from "react";
import { ResonableAccount } from "@resonable/schema";

const Jazz = createJazzReactApp({ AccountSchema: ResonableAccount });

export const { useAccount, useCoState, useAcceptInvite } = Jazz;

/**
 * Public Jazz Mesh sync server is used by default. It relays encrypted
 * ops only \u2014 it can't read household data, which keeps the "no central
 * authority" guarantee. Users can point `resonable.sync.peer` at a self-hosted
 * peer to avoid the default relay entirely.
 */
const defaultPeer = "wss://mesh.jazz.tools/?key=resonable@local.dev";

export function JazzApp({ children }: PropsWithChildren) {
  const [auth, authState] = useDemoAuth();
  const peer = (typeof localStorage !== "undefined"
    && localStorage.getItem("resonable.sync.peer"))
    || defaultPeer;

  return (
    <>
      <Jazz.Provider auth={auth} peer={peer as `wss://${string}`}>
        {children}
      </Jazz.Provider>
      <DemoAuthBasicUI appName="Resonable" state={authState} />
    </>
  );
}
