import type { MemberRoleT } from "@resonable/schema";

export type InvitePayload = {
  version: 1;
  householdId: string;
  role: MemberRoleT;
  secret: string;
  /** Optional URL hint for the sync relay; the accepter may already be on a different one. */
  syncHint?: string;
  /** Expiry timestamp in ms. Accepter rejects stale invites. */
  expiresAt: number;
};

export function encodeInvite(payload: InvitePayload): string {
  const json = JSON.stringify(payload);
  const b64 = typeof btoa === "function"
    ? btoa(unescape(encodeURIComponent(json)))
    : Buffer.from(json, "utf8").toString("base64");
  return `resonable-invite:${b64}`;
}

export function decodeInvite(encoded: string): InvitePayload {
  const prefix = "resonable-invite:";
  if (!encoded.startsWith(prefix)) throw new Error("not a resonable invite");
  const b64 = encoded.slice(prefix.length);
  const json = typeof atob === "function"
    ? decodeURIComponent(escape(atob(b64)))
    : Buffer.from(b64, "base64").toString("utf8");
  const parsed = JSON.parse(json) as InvitePayload;
  if (parsed.version !== 1) throw new Error("unsupported invite version");
  if (typeof parsed.expiresAt !== "number") throw new Error("invalid expiresAt");
  if (parsed.expiresAt < Date.now()) throw new Error("invite expired");
  return parsed;
}

export const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
