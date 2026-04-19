import type { GoCardlessCredentials } from "../gocardless/client";
import type { TokenPair } from "../gocardless/types";
import type { LLMClient } from "../llm/client";

/**
 * OS-level secret store. Tauri backs this with Stronghold / keychain.
 * Web fallback wraps WebCrypto + IndexedDB with a passphrase.
 * The key namespace should be scoped per household or per connection.
 */
export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

/**
 * CORS-safe bank data client. Concrete impls must not be callable
 * from a browser context that would be blocked by the origin policy.
 *
 * - TauriBankDataClient: Rust HTTP in the native side
 * - BrokerBankDataClient: tiny self-hosted proxy per household
 * - NodeBankDataClient: direct fetch in a Node daemon
 */
export interface BankDataClient {
  ensureTokens(connectionId: string, creds: GoCardlessCredentials): Promise<TokenPair>;
  listInstitutions(connectionId: string, country: string): Promise<{ id: string; name: string; logo?: string }[]>;
  createRequisition(
    connectionId: string,
    params: { institutionId: string; redirectUrl: string; reference?: string },
  ): Promise<{ id: string; link: string }>;
  getRequisition(connectionId: string, requisitionId: string): Promise<{ status: string; accounts: string[] }>;
  listTransactions(
    connectionId: string,
    accountId: string,
    params?: { dateFrom?: string; dateTo?: string },
  ): Promise<unknown>;
}

export type PlatformBridge = {
  secrets: SecretStore;
  bankData: BankDataClient;
  llm: LLMClient;
  /**
   * True when the platform can hold secrets at OS level and make CORS-exempt
   * calls. When false, the app should show a warning and degrade gracefully.
   */
  readonly isNative: boolean;
  /** Deep-link handler for OAuth-style redirects (Tauri only). */
  onOAuthRedirect?(handler: (url: URL) => void): () => void;
};
