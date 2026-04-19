import { co, z } from "jazz-tools";

/**
 * A GoCardless requisition representing a bank-link session.
 * Credentials (secret_id/key) never live here — they stay in the
 * connection owner's OS keychain. Only the short-lived access token
 * and refresh metadata are encrypted and shared via the household Group.
 */
export const Connection = co.map({
  provider: z.string(),
  institutionId: z.string(),
  institutionName: z.string(),
  requisitionId: z.string(),
  ownerAccountId: z.string(),
  status: z.string(),
  linkedAt: z.string(),
  lastSyncAt: z.optional(z.string()),
  lastError: z.optional(z.string()),
  /** Access tokens rotate — cached encrypted under the household Group so read-only members can sync reads. */
  accessTokenEncrypted: z.optional(z.string()),
  accessTokenExpiresAt: z.optional(z.string()),
  refreshTokenExpiresAt: z.optional(z.string()),
});
export type Connection = co.loaded<typeof Connection>;
