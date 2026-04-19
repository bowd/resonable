import type {
  GCAccount,
  Institution,
  Requisition,
  TokenPair,
  TransactionsResponse,
} from "./types";

export type GoCardlessCredentials = {
  secretId: string;
  secretKey: string;
};

export type GoCardlessClientOptions = {
  credentials: GoCardlessCredentials;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Called whenever a fresh token pair is minted so the caller can persist it. */
  onTokenRefreshed?: (tokens: TokenPair) => void | Promise<void>;
  /** Initial cached tokens \u2014 client will reuse until expiry. */
  initialTokens?: TokenPair;
};

/**
 * Thin GoCardless Bank Account Data client.
 *
 * Must run in a non-browser context (Tauri, Node) because the GoCardless API
 * does not send CORS headers.
 */
export class GoCardlessClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly credentials: GoCardlessCredentials;
  private readonly onTokenRefreshed?: (tokens: TokenPair) => void | Promise<void>;
  private tokens: TokenPair | undefined;

  constructor(opts: GoCardlessClientOptions) {
    this.baseUrl = opts.baseUrl ?? "https://bankaccountdata.gocardless.com";
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.credentials = opts.credentials;
    this.onTokenRefreshed = opts.onTokenRefreshed;
    this.tokens = opts.initialTokens;
  }

  async ensureAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.tokens && Date.parse(this.tokens.accessExpiresAt) - now > 60_000) {
      return this.tokens.access;
    }
    if (this.tokens && Date.parse(this.tokens.refreshExpiresAt) - now > 60_000) {
      await this.refreshAccessToken(this.tokens.refresh);
      return this.tokens!.access;
    }
    await this.mintNewTokens();
    return this.tokens!.access;
  }

  private async mintNewTokens(): Promise<void> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/v2/token/new/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        secret_id: this.credentials.secretId,
        secret_key: this.credentials.secretKey,
      }),
    });
    if (!res.ok) throw await apiError(res, "token/new");
    const body = (await res.json()) as {
      access: string;
      access_expires: number;
      refresh: string;
      refresh_expires: number;
    };
    const now = Date.now();
    this.tokens = {
      access: body.access,
      accessExpiresAt: new Date(now + body.access_expires * 1000).toISOString(),
      refresh: body.refresh,
      refreshExpiresAt: new Date(now + body.refresh_expires * 1000).toISOString(),
    };
    await this.onTokenRefreshed?.(this.tokens);
  }

  private async refreshAccessToken(refresh: string): Promise<void> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/v2/token/refresh/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ refresh }),
    });
    if (!res.ok) {
      if (res.status === 401) return this.mintNewTokens();
      throw await apiError(res, "token/refresh");
    }
    const body = (await res.json()) as { access: string; access_expires: number };
    const now = Date.now();
    this.tokens = {
      access: body.access,
      accessExpiresAt: new Date(now + body.access_expires * 1000).toISOString(),
      refresh,
      refreshExpiresAt: this.tokens!.refreshExpiresAt,
    };
    await this.onTokenRefreshed?.(this.tokens);
  }

  private async authed<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await this.ensureAccessToken();
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
    if (res.status === 401) {
      await this.mintNewTokens();
      return this.authed<T>(path, init);
    }
    if (!res.ok) throw await apiError(res, path);
    return (await res.json()) as T;
  }

  listInstitutions(country: string): Promise<Institution[]> {
    return this.authed<Institution[]>(
      `/api/v2/institutions/?country=${encodeURIComponent(country)}`,
    );
  }

  createRequisition(params: {
    institutionId: string;
    redirectUrl: string;
    reference?: string;
    maxHistoricalDays?: number;
    userLanguage?: string;
  }): Promise<Requisition> {
    return this.authed<Requisition>("/api/v2/requisitions/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        institution_id: params.institutionId,
        redirect: params.redirectUrl,
        reference: params.reference,
        max_historical_days: params.maxHistoricalDays,
        user_language: params.userLanguage,
      }),
    });
  }

  getRequisition(id: string): Promise<Requisition> {
    return this.authed<Requisition>(`/api/v2/requisitions/${id}/`);
  }

  deleteRequisition(id: string): Promise<void> {
    return this.authed<void>(`/api/v2/requisitions/${id}/`, { method: "DELETE" });
  }

  getAccount(accountId: string): Promise<GCAccount> {
    return this.authed<GCAccount>(`/api/v2/accounts/${accountId}/details/`);
  }

  listTransactions(
    accountId: string,
    params?: { dateFrom?: string; dateTo?: string },
  ): Promise<TransactionsResponse> {
    const qs = new URLSearchParams();
    if (params?.dateFrom) qs.set("date_from", params.dateFrom);
    if (params?.dateTo) qs.set("date_to", params.dateTo);
    const suffix = qs.toString() ? `?${qs}` : "";
    return this.authed<TransactionsResponse>(
      `/api/v2/accounts/${accountId}/transactions/${suffix}`,
    );
  }
}

async function apiError(res: Response, op: string): Promise<Error> {
  const text = await res.text().catch(() => "");
  return new Error(`GoCardless ${op} failed ${res.status}: ${text.slice(0, 500)}`);
}
