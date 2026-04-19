/**
 * Anti-griefing policy helpers. All enforcement still happens at the CRDT
 * Group-permission layer \u2014 these are the client-side gates we apply before
 * letting the user hit "confirm".
 */

export type HouseholdPolicy = {
  newMemberDefaultRole: "reader" | "writer" | "admin";
  requireAdminForRuleCreate: boolean;
  allowLLMAutoApply: boolean;
  autoApplyMinConfidence: number;
};

export const defaultPolicy: HouseholdPolicy = {
  newMemberDefaultRole: "reader",
  requireAdminForRuleCreate: true,
  allowLLMAutoApply: false,
  autoApplyMinConfidence: 0.9,
};

export type ActorRole = "reader" | "writer" | "admin";

export function canCreateRule(role: ActorRole, policy: HouseholdPolicy): boolean {
  if (role === "admin") return true;
  if (role === "writer") return !policy.requireAdminForRuleCreate;
  return false;
}

export function canLabelTransaction(role: ActorRole): boolean {
  return role === "writer" || role === "admin";
}

export function canRevokeLabel(role: ActorRole, isAuthor: boolean): boolean {
  if (role === "admin") return true;
  return isAuthor;
}

export function canAutoApplySuggestion(
  role: ActorRole,
  policy: HouseholdPolicy,
  confidence: number,
): boolean {
  if (!policy.allowLLMAutoApply) return false;
  if (confidence < policy.autoApplyMinConfidence) return false;
  return role === "writer" || role === "admin";
}

/**
 * Rolling rate limit. The CRDT layer lets a bad actor spam label overlays;
 * this bounds how many label events a member can produce per window so admins
 * have time to react. Measured from local event timestamps.
 */
export function isLabelRateLimited(
  recentTimestamps: number[],
  now: number = Date.now(),
  windowMs = 60_000,
  maxEventsInWindow = 60,
): boolean {
  const cutoff = now - windowMs;
  let count = 0;
  for (const t of recentTimestamps) if (t >= cutoff) count++;
  return count >= maxEventsInWindow;
}
