import { co, z } from "jazz-tools";

export const Money = co.map({
  amountMinor: z.number(),
  currency: z.string(),
});
export type Money = co.loaded<typeof Money>;

export const SyncStatus = ["idle", "syncing", "error", "expired"] as const;
export type SyncStatusT = (typeof SyncStatus)[number];

export const MemberRole = ["reader", "writer", "admin"] as const;
export type MemberRoleT = (typeof MemberRole)[number];
