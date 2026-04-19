/**
 * Passphrase-based symmetric encryption for household backups.
 *
 * - AES-256-GCM for authenticated encryption.
 * - PBKDF2-HMAC-SHA256, 600k iterations, random 16-byte salt.
 * - Random 12-byte IV per encryption.
 *
 * The on-disk bundle is a versioned JSON envelope (see `format.ts`) containing
 * base64 of salt + iv + ciphertext. This matches a common WebCrypto pattern
 * and is portable across browser / Node 20+ / Tauri.
 */

const ENC = new TextEncoder();
const DEC = new TextDecoder();

const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export type EncryptedBundle = {
  saltB64: string;
  ivB64: string;
  ciphertextB64: string;
  iterations: number;
};

export async function encryptWithPassphrase(
  plaintext: Uint8Array,
  passphrase: string,
): Promise<EncryptedBundle> {
  const subtle = getSubtle();
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveKey(subtle, passphrase, salt, PBKDF2_ITERATIONS);
  const ciphertext = new Uint8Array(
    await subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, plaintext as BufferSource),
  );
  return {
    saltB64: toBase64(salt),
    ivB64: toBase64(iv),
    ciphertextB64: toBase64(ciphertext),
    iterations: PBKDF2_ITERATIONS,
  };
}

export async function decryptWithPassphrase(
  bundle: EncryptedBundle,
  passphrase: string,
): Promise<Uint8Array> {
  const subtle = getSubtle();
  const salt = fromBase64(bundle.saltB64);
  const iv = fromBase64(bundle.ivB64);
  const ciphertext = fromBase64(bundle.ciphertextB64);
  const key = await deriveKey(subtle, passphrase, salt, bundle.iterations);
  try {
    const plaintext = await subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, ciphertext as BufferSource);
    return new Uint8Array(plaintext);
  } catch {
    throw new WrongPassphraseError();
  }
}

export class WrongPassphraseError extends Error {
  constructor() {
    super("wrong passphrase or corrupt bundle");
    this.name = "WrongPassphraseError";
  }
}

async function deriveKey(
  subtle: SubtleCrypto,
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const base = await subtle.importKey(
    "raw",
    ENC.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function getSubtle(): SubtleCrypto {
  const g = globalThis as unknown as { crypto?: Crypto };
  const subtle = g.crypto?.subtle;
  if (!subtle) throw new Error("WebCrypto SubtleCrypto unavailable");
  return subtle;
}

function randomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  (globalThis as unknown as { crypto: Crypto }).crypto.getRandomValues(buf);
  return buf;
}

function toBase64(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
    return btoa(s);
  }
  return Buffer.from(bytes).toString("base64");
}

function fromBase64(b64: string): Uint8Array {
  if (typeof atob === "function") {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, "base64"));
}

export const _textCodec = { encode: (s: string) => ENC.encode(s), decode: (b: Uint8Array) => DEC.decode(b) };
