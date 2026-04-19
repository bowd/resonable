import {
  BrokerBankDataClient,
  OllamaClient,
  TauriBankDataClient,
  TauriSecretStore,
  WebSecretStore,
  isTauriRuntime,
  type PlatformBridge,
} from "@resonable/core";

/**
 * Build the platform bridge for the current runtime.
 * Tauri is preferred; web falls back to a broker URL the user can configure
 * (we skip bank actions entirely when none is set).
 */
export function buildPlatform(): PlatformBridge {
  const llm = new OllamaClient({
    baseUrl: localStorage.getItem("resonable.llm.baseUrl") ?? "http://localhost:11434",
    model: localStorage.getItem("resonable.llm.model") ?? "llama3.2",
  });

  if (isTauriRuntime()) {
    return {
      secrets: new TauriSecretStore(),
      bankData: new TauriBankDataClient(),
      llm,
      isNative: true,
    };
  }

  const brokerUrl = localStorage.getItem("resonable.broker.url") ?? "";
  return {
    secrets: new WebSecretStore(),
    bankData: new BrokerBankDataClient(brokerUrl || "http://localhost:0"),
    llm,
    isNative: false,
  };
}

export const platform = buildPlatform();
