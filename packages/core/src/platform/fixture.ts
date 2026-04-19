import type { BankDataClient } from "./bridge";
import type { GoCardlessCredentials } from "../gocardless/client";
import type { TokenPair, TransactionsResponse, GCTransaction } from "../gocardless/types";
import { revolutFixture, n26Fixture } from "../import/fixtures";
import type { NormalizedTransaction } from "../gocardless/normalize";

/**
 * Zero-network BankDataClient used in demos, in tests, and when the web
 * build is running without a broker. It returns the same Revolut / N26
 * fixture each time so the UI can be exercised end-to-end.
 */
export class FixtureBankDataClient implements BankDataClient {
  async ensureTokens(_connectionId: string, _creds: GoCardlessCredentials): Promise<TokenPair> {
    const now = Date.now();
    return {
      access: "fixture-access",
      accessExpiresAt: new Date(now + 3600_000).toISOString(),
      refresh: "fixture-refresh",
      refreshExpiresAt: new Date(now + 86400_000).toISOString(),
    };
  }

  async listInstitutions(_connectionId: string, _country: string) {
    return [
      { id: "REVOLUT_REVOLT21", name: "Revolut" },
      { id: "N26_NTSBDEB1", name: "N26" },
    ];
  }

  async createRequisition(
    _connectionId: string,
    params: { institutionId: string; redirectUrl: string; reference?: string },
  ) {
    const reqId = `fixture-req-${params.institutionId}-${Date.now()}`;
    return { id: reqId, link: `about:blank#simulated-consent-${reqId}` };
  }

  async getRequisition(_connectionId: string, requisitionId: string) {
    const institution = /REVOLUT/.test(requisitionId) ? "rev" : "n26";
    return {
      status: "LN",
      accounts: [`${institution}-acc-1`],
    };
  }

  async listTransactions(
    _connectionId: string,
    accountId: string,
  ): Promise<TransactionsResponse> {
    const pick: NormalizedTransaction[] = accountId.startsWith("rev") ? revolutFixture : n26Fixture;
    return {
      transactions: {
        booked: pick.map(toGCShape),
        pending: [],
      },
    };
  }

  accountMeta(accountId: string) {
    const isRev = accountId.startsWith("rev");
    return {
      id: accountId,
      iban: isRev ? "AT60 1904 3002 3457 3201" : "DE89 3704 0044 0532 0130 00",
      name: isRev ? "Revolut EUR" : "N26 Main",
      currency: "EUR",
      institutionName: isRev ? "Revolut" : "N26",
    };
  }
}

function toGCShape(t: NormalizedTransaction): GCTransaction {
  const amount = (t.amountMinor / 100).toFixed(2);
  return {
    transactionId: t.externalId,
    bookingDate: t.bookedAt.slice(0, 10),
    bookingDateTime: t.bookedAt,
    transactionAmount: { amount, currency: t.currency },
    creditorName: t.amountMinor < 0 ? t.counterparty : undefined,
    debtorName: t.amountMinor >= 0 ? t.counterparty : undefined,
    remittanceInformationUnstructured: t.description,
  };
}
