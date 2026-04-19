import type { BankDataClient, SecretStore } from "./bridge";
import type { GoCardlessCredentials } from "../gocardless/client";
import type { TokenPair } from "../gocardless/types";

/**
 * Tauri-backed implementations. These forward to commands defined on the
 * Rust side so that:
 *  - secrets sit in the OS keychain / Stronghold
 *  - HTTP calls to api.gocardless.com bypass browser CORS via Rust reqwest
 *
 * Each command is referenced by name; the Rust crate is not in this repo
 * yet \u2014 add it under src-tauri/ when we wire the desktop shell.
 */

type TauriInvoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

function invoke(): TauriInvoke {
  const anyWin = globalThis as unknown as { __TAURI__?: { core?: { invoke?: TauriInvoke } } };
  const fn = anyWin.__TAURI__?.core?.invoke;
  if (!fn) throw new Error("Tauri runtime not detected");
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
  const anyWin = globalThis as unknown as { __TAURI__?: unknown };
  return Boolean(anyWin.__TAURI__);
}
