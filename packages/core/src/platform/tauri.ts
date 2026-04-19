import type { BankDataClient, SecretStore } from "./bridge";
import type { GoCardlessCredentials } from "../gocardless/client";
import type { TokenPair } from "../gocardless/types";

/**
 * Tauri 2 bridge.
 *
 * Tauri 2 exposes its command invoke at `window.__TAURI_INTERNALS__.invoke`
 * (not `window.__TAURI__` as in 1.x). We keep the core package free of
 * `@tauri-apps/api` by reading the global directly; when Tauri is present
 * the object is injected before the JS bundle runs.
 */

type TauriInvoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
type TauriInternals = { invoke: TauriInvoke };

function invoke(): TauriInvoke {
  const anyWin = globalThis as unknown as { __TAURI_INTERNALS__?: TauriInternals };
  const fn = anyWin.__TAURI_INTERNALS__?.invoke;
  if (!fn) throw new Error("Tauri runtime not detected (window.__TAURI_INTERNALS__ missing)");
  return fn;
}

export class TauriSecretStore implements SecretStore {
  async get(key: string) {
    return invoke()<string | null>("secrets_get", { key });
  }
  async set(key: string, value: string) {
    await invoke()("secrets_set", { key, value });
  }
  async delete(key: string) {
    await invoke()("secrets_delete", { key });
  }
  async list(prefix: string) {
    return invoke()<string[]>("secrets_list", { prefix });
  }
}

export class TauriBankDataClient implements BankDataClient {
  ensureTokens(connectionId: string, creds: GoCardlessCredentials): Promise<TokenPair> {
    return invoke()("gc_ensure_tokens", { connectionId, creds });
  }
  listInstitutions(connectionId: string, country: string) {
    return invoke()<{ id: string; name: string; logo?: string }[]>(
      "gc_list_institutions", { connectionId, country },
    );
  }
  createRequisition(connectionId: string, params: { institutionId: string; redirectUrl: string; reference?: string }) {
    return invoke()<{ id: string; link: string }>("gc_create_requisition", { connectionId, ...params });
  }
  getRequisition(connectionId: string, requisitionId: string) {
    return invoke()<{ status: string; accounts: string[] }>(
      "gc_get_requisition", { connectionId, requisitionId },
    );
  }
  listTransactions(connectionId: string, accountId: string, params?: { dateFrom?: string; dateTo?: string }) {
    return invoke()<unknown>("gc_list_transactions", { connectionId, accountId, ...(params ?? {}) });
  }
}

export function isTauriRuntime(): boolean {
  const anyWin = globalThis as unknown as { __TAURI_INTERNALS__?: unknown };
  return Boolean(anyWin.__TAURI_INTERNALS__);
}
