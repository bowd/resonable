import { CoMap, co } from "jazz-tools";

/**
 * A GoCardless requisition representing a bank-link session.
 * Credentials (secret_id/key) never live here \u2014 they stay in the
 * connection owner's OS keychain. Only the short-lived access token
 * and refresh metadata are encrypted and shared via the household Group.
 */
export class Connection extends CoMap {
  provider = co.string;
  institutionId = co.string;
  institutionName = co.string;
  requisitionId = co.string;
  ownerAccountId = co.string;
  status = co.string;
  linkedAt = co.string;
  lastSyncAt = co.optional.string;
  lastError = co.optional.string;
  /** Access tokens rotate \u2014 cached encrypted under the household Group so read-only members can sync reads. */
  accessTokenEncrypted = co.optional.string;
  accessTokenExpiresAt = co.optional.string;
  refreshTokenExpiresAt = co.optional.string;
}
