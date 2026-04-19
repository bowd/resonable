import { co, z } from "jazz-tools";
import { Connection } from "./connection";
import { TransactionList } from "./transaction";

export const Account = co.map({
  name: z.string(),
  iban: z.optional(z.string()),
  currency: z.string(),
  institutionName: z.string(),
  externalId: z.string(),
  connection: Connection,
  transactions: TransactionList,
  archived: z.boolean(),
  createdAt: z.string(),
});
export type Account = co.loaded<typeof Account>;

export const AccountList = co.list(Account);
export type AccountList = co.loaded<typeof AccountList>;
