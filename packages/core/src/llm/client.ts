export type LLMMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LLMRequest = {
  messages: LLMMessage[];
  /** Request a JSON-shaped response. Implementations should constrain when possible. */
  jsonSchema?: unknown;
  /** Sampling temperature. Keep low for classification. */
  temperature?: number;
  maxTokens?: number;
  /** Caller-supplied cancellation. */
  signal?: AbortSignal;
};

export type LLMResponse = {
  content: string;
  model: string;
};

export type EmbeddingsRequest = {
  input: string[];
  signal?: AbortSignal;
};

export type EmbeddingsResponse = {
  vectors: number[][];
  model: string;
};

export interface LLMClient {
  readonly name: string;
  readonly defaultModel: string;
  complete(req: LLMRequest): Promise<LLMResponse>;
  embed?(req: EmbeddingsRequest): Promise<EmbeddingsResponse>;
}
