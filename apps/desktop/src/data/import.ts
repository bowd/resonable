import { Group } from "jazz-tools";
import {
  Account,
  Connection,
  Household,
  Transaction,
  TransactionLabelList,
  AISuggestionList,
  TransactionList,
} from "@resonable/schema";
import {
  normalize,
  type BankDataClient,
  type NormalizedTransaction,
  type TransactionsResponse,
} from "@resonable/core";

export async function importAccountForConnection(params: {
  bank: BankDataClient;
  connectionId: string;
  requisitionId: string;
  household: Household;
  group: Group;
  meAccountId: string;
  institutionName: string;
  accountMeta?: (accountId: string) => {
    name: string; iban?: string; currency: string; institutionName: string;
  };
}): Promise<Account[]> {
  const status = await params.bank.getRequisition(params.connectionId, params.requisitionId);
  if (status.status !== "LN") throw new Error(`requisition not ready (status=${status.status})`);

  const created: Account[] = [];
  for (const accountId of status.accounts) {
    const meta = params.accountMeta?.(accountId) ?? {
      name: accountId,
      currency: "EUR",
      institutionName: params.institutionName,
    };
    const connection = Connection.create(
      {
        provider: "gocardless",
        institutionId: params.institutionName,
        institutionName: meta.institutionName,
        requisitionId: params.requisitionId,
        ownerAccountId: params.meAccountId,
        status: "linked",
        linkedAt: new Date().toISOString(),
      },
      { owner: params.group },
    );
    const transactions = TransactionList.create([], { owner: params.group });
    const account = Account.create(
      {
        name: meta.name,
        iban: meta.iban,
        currency: meta.currency,
        institutionName: meta.institutionName,
        externalId: accountId,
        connection,
        transactions,
        archived: false,
        createdAt: new Date().toISOString(),
      },
      { owner: params.group },
    );
    params.household.accounts?.push(account);

    const { added } = await syncAccount({
      bank: params.bank,
      connectionId: params.connectionId,
      account,
      group: params.group,
    });
    void added;
    created.push(account);
  }
  return created;
}

export async function syncAccount(params: {
  bank: BankDataClient;
  connectionId: string;
  account: Account;
  group: Group;
  dateFrom?: string;
}): Promise<{ added: Transaction[]; skipped: number }> {
  const resp = (await params.bank.listTransactions(
    params.connectionId,
    params.account.externalId,
    params.dateFrom ? { dateFrom: params.dateFrom } : undefined,
  )) as TransactionsResponse;

  const existingIds = new Set<string>();
  for (const t of params.account.transactions ?? []) {
    if (t) existingIds.add(t.externalId);
  }

  const added: Transaction[] = [];
  let skipped = 0;
  for (const raw of resp.transactions.booked) {
    const n = normalize(raw);
    if (existingIds.has(n.externalId)) { skipped++; continue; }
    const tx = createTxCoValue(n, params.account.id, params.group);
    params.account.transactions?.push(tx);
    added.push(tx);
    existingIds.add(n.externalId);
  }
  return { added, skipped };
}

function createTxCoValue(n: NormalizedTransaction, accountId: string, group: Group): Transaction {
  return Transaction.create(
    {
      externalId: n.externalId,
      bookedAt: n.bookedAt,
      valueDate: n.valueDate,
      amountMinor: n.amountMinor,
      currency: n.currency,
      counterparty: n.counterparty,
      description: n.description,
      rawPayloadJson: n.rawPayloadJson,
      accountId,
      labels: TransactionLabelList.create([], { owner: group }),
      suggestions: AISuggestionList.create([], { owner: group }),
    },
    { owner: group },
  );
}
