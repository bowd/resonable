import type { ReactNode } from "react";
import { useCurrentAccount } from "../jazz";

type Props = { loading?: boolean; children: ReactNode };

/**
 * Blocks rendering of a view while Jazz is still resolving the current
 * account. Callers can force the loading state with `loading={true}`; when
 * omitted, the gate peeks at the account's `$isLoaded` itself so individual
 * views don't each need to plumb the flag through.
 */
export function LoadingGate({ loading, children }: Props) {
  const me = useCurrentAccount();
  const isLoading = loading ?? !me.$isLoaded;

  if (isLoading) {
    return (
      <div
        style={{
          color: "var(--muted)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: 16,
          margin: 16,
          maxWidth: 320,
          fontSize: 13,
        }}
      >
        Loading…
      </div>
    );
  }

  return <>{children}</>;
}
