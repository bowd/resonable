import type { GCTransaction } from "./types";

export type NormalizedTransaction = {
  externalId: string;
  bookedAt: string;
  valueDate?: string;
  amountMinor: number;
  currency: string;
  counterparty?: string;
  description: string;
  rawPayloadJson: string;
};

/**
 * Map a GoCardless booked transaction into our normalized shape.
 * GC amounts are decimal strings; we convert to minor units (integer cents)
 * to avoid floating-point drift in rule matching.
 */
export function normalize(gc: GCTransaction): NormalizedTransaction {
  const amountMinor = decimalToMinor(gc.transactionAmount.amount);
  const counterparty =
    (amountMinor < 0 ? gc.creditorName : gc.debtorName) ??
    gc.creditorName ??
    gc.debtorName;
  const remittance =
    gc.remittanceInformationUnstructuredArray?.join(" ") ??
    gc.remittanceInformationUnstructured ??
    gc.additionalInformation ??
    "";
  return {
    externalId:
      gc.transactionId ?? gc.internalTransactionId ?? synthId(gc),
    bookedAt: gc.bookingDateTime ?? gc.bookingDate ?? new Date().toISOString(),
    valueDate: gc.valueDate,
    amountMinor,
    currency: gc.transactionAmount.currency,
    counterparty: counterparty?.trim(),
    description: remittance.trim(),
    rawPayloadJson: JSON.stringify(gc),
  };
}

function decimalToMinor(decimal: string): number {
  const neg = decimal.startsWith("-");
  const abs = neg ? decimal.slice(1) : decimal;
  const [intPart, fracPart = ""] = abs.split(".");
  const frac = (fracPart + "00").slice(0, 2);
  const minor = Number.parseInt(intPart ?? "0", 10) * 100 + Number.parseInt(frac || "0", 10);
  return neg ? -minor : minor;
}

function synthId(gc: GCTransaction): string {
  const payload = `${gc.bookingDate ?? ""}|${gc.transactionAmount.amount}|${gc.transactionAmount.currency}|${gc.creditorName ?? ""}|${gc.debtorName ?? ""}|${gc.remittanceInformationUnstructured ?? ""}`;
  let hash = 0;
  for (let i = 0; i < payload.length; i++) hash = (hash * 31 + payload.charCodeAt(i)) | 0;
  return `synth-${Math.abs(hash).toString(36)}`;
}
