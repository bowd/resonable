import { Group } from "jazz-tools";
import {
  Account,
  AISuggestionList,
  Connection,
  type LoadedAccount,
  type LoadedHousehold,
  type LoadedTransaction,
  Transaction,
  TransactionLabelList,
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
  household: LoadedHousehold;
  group: Group;
  meAccountId: string;
  institutionName: string;
  accountMeta?: (accountId: string) => {
    name: string; iban?: string; currency: string; institutionName: string;
  };
}): Promise<LoadedAccount[]> {
  const status = await params.bank.getRequisition(params.connectionId, params.requisitionId);
  if (status.status !== "LN") throw new Error(`requisition not ready (status=${status.status})`);

  const created: LoadedAccount[] = [];
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
    params.household.accounts.$jazz.push(account);

    const { added } = await syncAccount({
      bank: params.bank,
      connectionId: params.connectionId,
      account: account as LoadedAccount,
      group: params.group,
    });
    void added;
    created.push(account as LoadedAccount);
  }
  return created;
}

export async function syncAccount(params: {
  bank: BankDataClient;
  connectionId: string;
  account: LoadedAccount;
  group: Group;
  dateFrom?: string;
}): Promise<{ added: LoadedTransaction[]; skipped: number }> {
  const resp = (await params.bank.listTransactions(
    params.connectionId,
    params.account.externalId,
    params.dateFrom ? { dateFrom: params.dateFrom } : undefined,
  )) as TransactionsResponse;

  const existingIds = new Set<string>();
  for (const t of params.account.transactions as unknown as ReadonlyArray<LoadedTransaction>) {
    if (t) existingIds.add(t.externalId);
  }

  const added: LoadedTransaction[] = [];
  let skipped = 0;
  for (const raw of resp.transactions.booked) {
    const n = normalize(raw);
    if (existingIds.has(n.externalId)) { skipped++; continue; }
    const tx = createTxCoValue(n, params.account.$jazz.id, params.group);
    params.account.transactions.$jazz.push(tx);
    added.push(tx as LoadedTransaction);
    existingIds.add(n.externalId);
  }
  return { added, skipped };
}

/**
 * Append CSV-derived transactions to an account, deduping by externalId the
 * same way `syncAccount` does. No network calls happen here; the caller is
 * responsible for parsing the CSV and producing `NormalizedTransaction`s.
 */
export function importCsvToAccount(
  account: LoadedAccount,
  normalized: NormalizedTransaction[],
  group: Group,
): { added: LoadedTransaction[]; skipped: number } {
  const existingIds = new Set<string>();
  for (const t of account.transactions as unknown as ReadonlyArray<LoadedTransaction>) {
    if (t) existingIds.add(t.externalId);
  }
  const added: LoadedTransaction[] = [];
  let skipped = 0;
  for (const n of normalized) {
    if (existingIds.has(n.externalId)) { skipped++; continue; }
    const tx = createTxCoValue(n, account.$jazz.id, group);
    account.transactions.$jazz.push(tx);
    added.push(tx as LoadedTransaction);
    existingIds.add(n.externalId);
  }
  return { added, skipped };
}

function createTxCoValue(n: NormalizedTransaction, accountId: string, group: Group) {
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
