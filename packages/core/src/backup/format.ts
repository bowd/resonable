import { decryptWithPassphrase, encryptWithPassphrase, _textCodec, type EncryptedBundle } from "./crypto";

/**
 * Versioned plain-JSON backup payload. Decoupled from Jazz types so a backup
 * written today can be restored tomorrow even if the schema adds fields.
 * The bindings layer is responsible for mapping CoValues -> BackupPayload
 * and back.
 */
export type BackupPayload = {
  version: 1;
  householdName: string;
  createdAt: string;
  accounts: BackupAccount[];
  categories: BackupCategory[];
  tags: BackupTag[];
  rules: BackupRule[];
};

export type BackupAccount = {
  externalId: string;
  name: string;
  institutionName: string;
  currency: string;
  iban?: string;
  archived: boolean;
  createdAt: string;
  transactions: BackupTransaction[];
};

export type BackupTransaction = {
  externalId: string;
  bookedAt: string;
  valueDate?: string;
  amountMinor: number;
  currency: string;
  counterparty?: string;
  description: string;
  rawPayloadJson: string;
  labels: BackupLabel[];
};

export type BackupLabel = {
  byAccountId: string;
  at: string;
  categoryExternalId?: string;
  addTagExternalId?: string;
  removeTagExternalId?: string;
  source: string;
  ruleId?: string;
  confidence?: number;
  note?: string;
  revoked: boolean;
};

export type BackupCategory = {
  externalId: string;
  name: string;
  color: string;
  icon?: string;
  archived: boolean;
};

export type BackupTag = {
  externalId: string;
  name: string;
  color: string;
  archived: boolean;
};

export type BackupRule = {
  externalId: string;
  name: string;
  specJson: string;
  priority: number;
  enabled: boolean;
  source: string;
  confidence: number;
  createdByAccountId: string;
  createdAt: string;
  hitCount: number;
  provenance?: string;
};

export type BackupEnvelope = {
  magic: "resonable-backup";
  schemaVersion: 1;
  writtenAt: string;
  payload: EncryptedBundle;
};

export async function serializeBackup(
  payload: BackupPayload,
  passphrase: string,
): Promise<BackupEnvelope> {
  const json = JSON.stringify(payload);
  const encrypted = await encryptWithPassphrase(_textCodec.encode(json), passphrase);
  return {
    magic: "resonable-backup",
    schemaVersion: 1,
    writtenAt: new Date().toISOString(),
    payload: encrypted,
  };
}

export async function deserializeBackup(
  envelope: BackupEnvelope,
  passphrase: string,
): Promise<BackupPayload> {
  if (envelope.magic !== "resonable-backup") {
    throw new Error("not a resonable backup envelope");
  }
  if (envelope.schemaVersion !== 1) {
    throw new Error(`unsupported backup schema version: ${envelope.schemaVersion}`);
  }
  const bytes = await decryptWithPassphrase(envelope.payload, passphrase);
  const payload = JSON.parse(_textCodec.decode(bytes)) as BackupPayload;
  if (payload.version !== 1) throw new Error(`unsupported payload version: ${payload.version}`);
  return payload;
}

export function envelopeToBlob(envelope: BackupEnvelope): { bytes: Uint8Array; suggestedFilename: string } {
  const json = JSON.stringify(envelope, null, 2);
  const bytes = _textCodec.encode(json);
  const datePart = envelope.writtenAt.slice(0, 10);
  return { bytes, suggestedFilename: `resonable-backup-${datePart}.json` };
}

export function parseEnvelope(text: string): BackupEnvelope {
  const parsed = JSON.parse(text) as BackupEnvelope;
  if (parsed.magic !== "resonable-backup") {
    throw new Error("not a resonable backup envelope");
  }
  return parsed;
}
