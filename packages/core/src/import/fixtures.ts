import type { NormalizedTransaction } from "../gocardless/normalize";

const eur = (amountMinor: number, overrides: Partial<NormalizedTransaction> & Pick<NormalizedTransaction, "externalId" | "bookedAt">) => ({
  amountMinor,
  currency: "EUR",
  description: "",
  rawPayloadJson: "{}",
  ...overrides,
});

export const revolutFixture: NormalizedTransaction[] = [
  eur(-1299, { externalId: "rv-001", bookedAt: "2026-04-01T09:00:00Z", counterparty: "Netflix Intl BV",   description: "Netflix.com subscription" }),
  eur(-1099, { externalId: "rv-002", bookedAt: "2026-04-02T10:15:00Z", counterparty: "Spotify AB",         description: "SPOTIFY Premium" }),
  eur( -650, { externalId: "rv-003", bookedAt: "2026-04-03T12:32:00Z", counterparty: "BILLA 4411 Wien",    description: "Card payment BILLA 4411 1070 WIEN" }),
  eur( -780, { externalId: "rv-004", bookedAt: "2026-04-05T18:44:00Z", counterparty: "BILLA PLUS 2201",    description: "BILLA PLUS 2201 1080 WIEN" }),
  eur(-4250, { externalId: "rv-005", bookedAt: "2026-04-07T20:12:00Z", counterparty: "OEBB Ticketshop",    description: "OEBB Vienna-Salzburg" }),
  eur(-1820, { externalId: "rv-006", bookedAt: "2026-04-08T13:01:00Z", counterparty: "Figlmueller",       description: "Figlmueller Lugeck Vienna" }),
  eur(-1299, { externalId: "rv-007", bookedAt: "2026-05-01T09:00:00Z", counterparty: "Netflix Intl BV",   description: "Netflix.com subscription" }),
  eur(-1099, { externalId: "rv-008", bookedAt: "2026-05-02T10:15:00Z", counterparty: "Spotify AB",         description: "SPOTIFY Premium" }),
  eur(250000, { externalId: "rv-009", bookedAt: "2026-04-01T08:00:00Z", counterparty: "ACME GmbH",         description: "Salary April" }),
];

export const n26Fixture: NormalizedTransaction[] = [
  eur( -420, { externalId: "n26-001", bookedAt: "2026-04-04T07:30:00Z", counterparty: "Hofer Filiale 0812", description: "MASTERCARD HOFER 0812" }),
  eur( -390, { externalId: "n26-002", bookedAt: "2026-04-09T19:20:00Z", counterparty: "Hofer Filiale 0414", description: "HOFER KG 0414 LINZ" }),
  eur(-3499, { externalId: "n26-003", bookedAt: "2026-04-06T11:44:00Z", counterparty: "Amazon EU S.a.r.l.", description: "Amazon Marketplace order" }),
  eur(-1190, { externalId: "n26-004", bookedAt: "2026-04-10T08:11:00Z", counterparty: "Wiener Linien",      description: "Jahreskarte Wien" }),
  eur(-2500, { externalId: "n26-005", bookedAt: "2026-04-12T21:05:00Z", counterparty: "Bitpanda GmbH",      description: "Top-up Bitpanda" }),
  eur( -899, { externalId: "n26-006", bookedAt: "2026-04-14T12:00:00Z", counterparty: "Amazon EU S.a.r.l.", description: "Amazon Prime renewal" }),
];

export const allFixtures = { revolut: revolutFixture, n26: n26Fixture };
