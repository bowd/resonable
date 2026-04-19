import {
  BrokerBankDataClient,
  FixtureBankDataClient,
  OllamaClient,
  TauriBankDataClient,
  TauriSecretStore,
  WebSecretStore,
  isTauriRuntime,
  type PlatformBridge,
} from "@resonable/core";

export type PlatformMode = "tauri" | "broker" | "fixture";

export function platformMode(): PlatformMode {
  if (isTauriRuntime()) return "tauri";
  if (typeof localStorage !== "undefined" && localStorage.getItem("resonable.demo") === "1") {
    return "fixture";
  }
  if (typeof localStorage !== "undefined" && localStorage.getItem("resonable.broker.url")) {
    return "broker";
  }
  return "fixture";
}

/**
 * Build the platform bridge for the current runtime.
 * Tauri wins when available; web falls back to a self-host broker or, for
 * dev / demos, a local fixture client that serves Revolut/N26 sample data.
 */
export function buildPlatform(): PlatformBridge & { mode: PlatformMode } {
  const llm = new OllamaClient({
    baseUrl: localStorage.getItem("resonable.llm.baseUrl") ?? "http://localhost:11434",
    model: localStorage.getItem("resonable.llm.model") ?? "llama3.2",
  });

  const mode = platformMode();
  if (mode === "tauri") {
    return {
      secrets: new TauriSecretStore(),
      bankData: new TauriBankDataClient(),
      llm,
      isNative: true,
      mode,
    };
  }
  if (mode === "broker") {
    return {
      secrets: new WebSecretStore(),
      bankData: new BrokerBankDataClient(localStorage.getItem("resonable.broker.url")!),
      llm,
      isNative: false,
      mode,
    };
  }
  return {
    secrets: new WebSecretStore(),
    bankData: new FixtureBankDataClient(),
    llm,
    isNative: false,
    mode,
  };
}

export const platform = buildPlatform();

export function fixtureBank(): FixtureBankDataClient | null {
  return platform.bankData instanceof FixtureBankDataClient ? platform.bankData : null;
}
