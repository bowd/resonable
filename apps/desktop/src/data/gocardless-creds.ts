import type { BankDataClient, GoCardlessCredentials, SecretStore } from "@resonable/core";

const SECRET_ID_KEY = "gocardless:secret_id";
const SECRET_KEY_KEY = "gocardless:secret_key";

/**
 * Store-or-load the user's GoCardless secret_id + secret_key from the platform
 * secret store. In Tauri this is the OS keychain; in the web fallback it's
 * WebCrypto-wrapped IndexedDB (unlocked by a passphrase).
 *
 * Creds are per-member, not per-household: one GoCardless app per user.
 */

export async function saveGoCardlessCreds(
  secrets: SecretStore,
  creds: GoCardlessCredentials,
): Promise<void> {
  await secrets.set(SECRET_ID_KEY, creds.secretId);
  await secrets.set(SECRET_KEY_KEY, creds.secretKey);
}

export async function loadGoCardlessCreds(
  secrets: SecretStore,
): Promise<GoCardlessCredentials | null> {
  const secretId = await secrets.get(SECRET_ID_KEY);
  const secretKey = await secrets.get(SECRET_KEY_KEY);
  if (!secretId || !secretKey) return null;
  return { secretId, secretKey };
}

export async function clearGoCardlessCreds(secrets: SecretStore): Promise<void> {
  await secrets.delete(SECRET_ID_KEY);
  await secrets.delete(SECRET_KEY_KEY);
}

export class MissingCredentialsError extends Error {
  constructor() {
    super("GoCardless credentials are not configured. Open Settings to add them.");
    this.name = "MissingCredentialsError";
  }
}

/**
 * Refresh (or mint) the GoCardless token pair for this connection. Call this
 * before any bank-data operation; the Rust side caches tokens under
 * `connectionId` and subsequent list/create/get commands reuse the cache.
 */
export async function ensureBankCredsReady(
  bank: BankDataClient,
  secrets: SecretStore,
  connectionId: string,
): Promise<void> {
  const creds = await loadGoCardlessCreds(secrets);
  if (!creds) throw new MissingCredentialsError();
  await bank.ensureTokens(connectionId, creds);
}
