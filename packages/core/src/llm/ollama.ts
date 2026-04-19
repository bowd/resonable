import type {
  EmbeddingsRequest,
  EmbeddingsResponse,
  LLMClient,
  LLMRequest,
  LLMResponse,
} from "./client";

export type OllamaOptions = {
  baseUrl?: string;
  model?: string;
  embeddingModel?: string;
  fetchImpl?: typeof fetch;
};

export class OllamaClient implements LLMClient {
  readonly name = "ollama";
  readonly defaultModel: string;
  private readonly baseUrl: string;
  private readonly embeddingModel: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: OllamaOptions = {}) {
    this.baseUrl = opts.baseUrl ?? "http://localhost:11434";
    this.defaultModel = opts.model ?? "llama3.2";
    this.embeddingModel = opts.embeddingModel ?? "nomic-embed-text";
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: req.signal,
      body: JSON.stringify({
        model: this.defaultModel,
        messages: req.messages,
        stream: false,
        format: req.jsonSchema ? "json" : undefined,
        options: {
          temperature: req.temperature ?? 0.1,
          num_predict: req.maxTokens,
        },
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Ollama chat failed ${res.status}: ${text.slice(0, 500)}`);
    }
    const body = (await res.json()) as { model: string; message: { content: string } };
    return { content: body.message.content, model: body.model };
  }

  async embed(req: EmbeddingsRequest): Promise<EmbeddingsResponse> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: req.signal,
      body: JSON.stringify({ model: this.embeddingModel, input: req.input }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Ollama embed failed ${res.status}: ${text.slice(0, 500)}`);
    }
    const body = (await res.json()) as { model: string; embeddings: number[][] };
    return { vectors: body.embeddings, model: body.model };
  }
}
