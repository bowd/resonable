import { CoMap, CoList, co } from "jazz-tools";
import { Connection } from "./connection";
import { TransactionList } from "./transaction";

export class Account extends CoMap {
  name = co.string;
  iban = co.optional.string;
  currency = co.string;
  institutionName = co.string;
  externalId = co.string;
  connection = co.ref(Connection);
  transactions = co.ref(TransactionList);
  archived = co.boolean;
  createdAt = co.string;
}

export class AccountList extends CoList.Of(co.ref(Account)) {}
