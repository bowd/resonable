import { describe, expect, it } from "vitest";
import {
  WrongPassphraseError,
  decryptWithPassphrase,
  encryptWithPassphrase,
} from "./crypto";
import {
  deserializeBackup,
  envelopeToBlob,
  parseEnvelope,
  serializeBackup,
  type BackupPayload,
} from "./format";

const samplePayload: BackupPayload = {
  version: 1,
  householdName: "Our flat",
  createdAt: "2026-04-19T10:00:00Z",
  accounts: [
    {
      externalId: "acc-rev-1",
      name: "Revolut EUR",
      institutionName: "Revolut",
      currency: "EUR",
      iban: "AT60...",
      archived: false,
      createdAt: "2026-04-01T00:00:00Z",
      transactions: [
        {
          externalId: "tx-1",
          bookedAt: "2026-04-10T10:00:00Z",
          amountMinor: -1299,
          currency: "EUR",
          counterparty: "Netflix",
          description: "Netflix.com",
          rawPayloadJson: "{}",
          labels: [
            {
              byAccountId: "acc-user-1",
              at: "2026-04-10T10:05:00Z",
              categoryExternalId: "cat-subs",
              source: "rule",
              ruleId: "rule-1",
              confidence: 1,
              revoked: false,
            },
          ],
        },
      ],
    },
  ],
  categories: [
    { externalId: "cat-subs", name: "Subscriptions", color: "#a855f7", archived: false },
  ],
  tags: [
    { externalId: "tag-recurring", name: "recurring", color: "#a855f7", archived: false },
  ],
  rules: [
    {
      externalId: "rule-1",
      name: "Streaming",
      specJson: "{}",
      priority: 0,
      enabled: true,
      source: "derived",
      confidence: 0.95,
      createdByAccountId: "acc-user-1",
      createdAt: "2026-04-01T00:00:00Z",
      hitCount: 1,
    },
  ],
};

describe("crypto", () => {
  const data = new TextEncoder().encode("hello resonable");

  it("round-trips plaintext through a passphrase", async () => {
    const bundle = await encryptWithPassphrase(data, "correct horse battery staple");
    const back = await decryptWithPassphrase(bundle, "correct horse battery staple");
    expect(new TextDecoder().decode(back)).toBe("hello resonable");
  });

  it("rejects a wrong passphrase", async () => {
    const bundle = await encryptWithPassphrase(data, "correct");
    await expect(decryptWithPassphrase(bundle, "wrong")).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it("uses fresh salts and IVs per encryption", async () => {
    const a = await encryptWithPassphrase(data, "pw");
    const b = await encryptWithPassphrase(data, "pw");
    expect(a.saltB64).not.toBe(b.saltB64);
    expect(a.ivB64).not.toBe(b.ivB64);
    expect(a.ciphertextB64).not.toBe(b.ciphertextB64);
  });
});

describe("backup envelope", () => {
  it("round-trips a full payload", async () => {
    const envelope = await serializeBackup(samplePayload, "pw");
    const decoded = await deserializeBackup(envelope, "pw");
    expect(decoded).toEqual(samplePayload);
  });

  it("rejects a wrong passphrase at deserialize", async () => {
    const envelope = await serializeBackup(samplePayload, "pw");
    await expect(deserializeBackup(envelope, "wrong")).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it("rejects a foreign envelope", async () => {
    const envelope = await serializeBackup(samplePayload, "pw");
    const tampered = { ...envelope, magic: "not-ours" as never };
    await expect(deserializeBackup(tampered, "pw")).rejects.toThrow(/not a resonable backup/);
  });

  it("emits a JSON file via envelopeToBlob and reparses it", async () => {
    const envelope = await serializeBackup(samplePayload, "pw");
    const { bytes, suggestedFilename } = envelopeToBlob(envelope);
    expect(suggestedFilename).toMatch(/^resonable-backup-\d{4}-\d{2}-\d{2}\.json$/);
    const text = new TextDecoder().decode(bytes);
    const parsed = parseEnvelope(text);
    const decoded = await deserializeBackup(parsed, "pw");
    expect(decoded.householdName).toBe("Our flat");
  });
});
