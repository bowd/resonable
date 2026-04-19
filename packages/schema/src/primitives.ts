import { CoMap, co } from "jazz-tools";

export class Money extends CoMap {
  amountMinor = co.number;
  currency = co.string;
}

export const SyncStatus = ["idle", "syncing", "error", "expired"] as const;
export type SyncStatusT = (typeof SyncStatus)[number];

export const MemberRole = ["reader", "writer", "admin"] as const;
export type MemberRoleT = (typeof MemberRole)[number];
