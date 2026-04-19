import type { SecretStore, BankDataClient } from "./bridge";
import type { GoCardlessCredentials } from "../gocardless/client";
import type { TokenPair } from "../gocardless/types";

/**
 * IndexedDB-backed SecretStore for the web. Values are AES-GCM encrypted
 * with a key derived from a user passphrase via PBKDF2. This is a
 * best-effort fallback \u2014 Tauri's native keychain is preferred.
 */
export class WebSecretStore implements SecretStore {
  private readonly dbName = "resonable-secrets";
  private readonly storeName = "kv";
  private key: CryptoKey | null = null;

  async unlock(passphrase: string, saltB64?: string): Promise<string> {
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey(
      "raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"],
    );
    const salt = saltB64
      ? Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0))
      : crypto.getRandomValues(new Uint8Array(16));
    this.key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 210_000, hash: "SHA-256" },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    return btoa(String.fromCharCode(...salt));
  }

  async get(key: string): Promise<string | null> {
    this.assertUnlocked();
    const row = await idbGet<{ iv: ArrayBuffer; ct: ArrayBuffer } | undefined>(
      this.dbName, this.storeName, key,
    );
    if (!row) return null;
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(row.iv) },
      this.key!,
      row.ct,
    );
    return new TextDecoder().decode(plaintext);
  }

  async set(key: string, value: string): Promise<void> {
    this.assertUnlocked();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv }, this.key!, new TextEncoder().encode(value),
    );
    await idbPut(this.dbName, this.storeName, key, { iv: iv.buffer, ct });
  }

  async delete(key: string): Promise<void> {
    await idbDelete(this.dbName, this.storeName, key);
  }

  async list(prefix: string): Promise<string[]> {
    const keys = await idbKeys(this.dbName, this.storeName);
    return keys.filter((k) => k.startsWith(prefix));
  }

  private assertUnlocked(): void {
    if (!this.key) throw new Error("SecretStore locked \u2014 call unlock() first");
  }
}

/**
 * Minimal broker-based bank data client: talks to a small stateless
 * proxy the household can self-host. Not wired to a real broker yet \u2014
 * placeholder to keep the interface honest for the web fallback.
 */
export class BrokerBankDataClient implements BankDataClient {
  constructor(private readonly brokerUrl: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async ensureTokens(connectionId: string, creds: GoCardlessCredentials): Promise<TokenPair> {
    return this.post(`/connections/${encodeURIComponent(connectionId)}/tokens`, creds);
  }
  listInstitutions(connectionId: string, country: string) {
    return this.post<{ id: string; name: string; logo?: string }[]>(
      `/connections/${encodeURIComponent(connectionId)}/institutions`, { country },
    );
  }
  createRequisition(connectionId: string, params: { institutionId: string; redirectUrl: string; reference?: string }) {
    return this.post<{ id: string; link: string }>(
      `/connections/${encodeURIComponent(connectionId)}/requisitions`, params,
    );
  }
  getRequisition(connectionId: string, requisitionId: string) {
    return this.post<{ status: string; accounts: string[] }>(
      `/connections/${encodeURIComponent(connectionId)}/requisitions/${requisitionId}`, {},
    );
  }
  listTransactions(connectionId: string, accountId: string, params?: { dateFrom?: string; dateTo?: string }) {
    return this.post<unknown>(
      `/connections/${encodeURIComponent(connectionId)}/accounts/${accountId}/transactions`, params ?? {},
    );
  }
  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.brokerUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`broker ${path} failed ${res.status}`);
    return (await res.json()) as T;
  }
}

function openDb(name: string, store: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(store);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(db: string, store: string, key: string): Promise<T | undefined> {
  const d = await openDb(db, store);
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(db: string, store: string, key: string, val: unknown): Promise<void> {
  const d = await openDb(db, store);
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(store, "readwrite");
    tx.objectStore(store).put(val, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(db: string, store: string, key: string): Promise<void> {
  const d = await openDb(db, store);
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbKeys(db: string, store: string): Promise<string[]> {
  const d = await openDb(db, store);
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, "readonly");
    const req = tx.objectStore(store).getAllKeys();
    req.onsuccess = () => resolve((req.result as IDBValidKey[]).map(String));
    req.onerror = () => reject(req.error);
  });
}
