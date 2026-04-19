import type { Page, TestInfo } from "@playwright/test";
import { test } from "@playwright/test";

/**
 * Flip the desktop app into fixture/demo mode before any script runs on the page.
 *
 * The desktop's `platform.ts` checks `localStorage.resonable.demo === "1"` on
 * module load, so we must set it via `addInitScript` so it is present before
 * the first bundle parses.
 */
export async function bootstrapDemo(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("resonable.demo", "1");
    } catch {
      // storage can throw in private-mode contexts; ignore
    }
  });
}

/**
 * Minimal shape of the Stagehand surface we exercise in tests.
 * Wrapping behind an interface lets us:
 *   - fall back to a no-op when ANTHROPIC_API_KEY is absent
 *   - isolate callers from Stagehand major-version churn.
 */
export interface StagehandLike {
  readonly enabled: boolean;
  act(instruction: string): Promise<void>;
  observe(instruction: string): Promise<unknown>;
  extract<T = { extraction: string }>(instruction: string): Promise<T>;
  close(): Promise<void>;
}

interface NewStagehandResult {
  stagehand: StagehandLike;
  /** True when backed by a real Stagehand V3 instance driving the page via LLM. */
  ai: boolean;
}

/**
 * Wrap an existing Playwright page in a Stagehand-like façade.
 *
 * Stagehand V3 manages its own Chrome/Browserbase context, so we cannot
 * literally share this Playwright `page`. When `ANTHROPIC_API_KEY` is set we
 * spin up a Stagehand V3 instance pointed at the same `baseURL`, navigate it
 * in parallel, and let the test drive both. When the key is absent (or
 * Stagehand cannot initialize) we return a safe no-op that records a skip
 * reason; callers should gate AI-only assertions with `skipWithoutAI`.
 */
export async function newStagehand(
  page: Page,
  testInfo?: TestInfo,
): Promise<NewStagehandResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { stagehand: noopStagehand("ANTHROPIC_API_KEY not set"), ai: false };
  }

  // Lazy-import so typecheck / plain-Playwright runs don't require Stagehand
  // to fully resolve its (heavy) optional sub-modules at collect time.
  let StagehandCtor: unknown;
  try {
    const mod = (await import("@browserbasehq/stagehand")) as Record<string, unknown>;
    StagehandCtor = mod.Stagehand ?? mod.V3 ?? (mod as { default?: { Stagehand?: unknown } }).default?.Stagehand;
  } catch (err) {
    testInfo?.annotations.push({
      type: "stagehand-init-failed",
      description: err instanceof Error ? err.message : String(err),
    });
    return { stagehand: noopStagehand("stagehand import failed"), ai: false };
  }
  if (typeof StagehandCtor !== "function") {
    return { stagehand: noopStagehand("stagehand constructor not found"), ai: false };
  }

  type V3Like = {
    init(): Promise<void>;
    act(instruction: string): Promise<unknown>;
    observe(instruction: string): Promise<unknown>;
    extract(instruction: string): Promise<unknown>;
    close(opts?: { force?: boolean }): Promise<void>;
    context: { pages: { goto(url: string): Promise<unknown> }[] };
  };

  let instance: V3Like;
  try {
    const Ctor = StagehandCtor as new (opts: Record<string, unknown>) => V3Like;
    instance = new Ctor({
      env: "LOCAL",
      verbose: 0,
      disablePino: true,
      model: {
        modelName: process.env.RESONABLE_E2E_MODEL ?? "claude-opus-4-7",
        apiKey,
      },
      localBrowserLaunchOptions: {
        headless: true,
        viewport: { width: 1280, height: 900 },
      },
    });
    await instance.init();
  } catch (err) {
    testInfo?.annotations.push({
      type: "stagehand-init-failed",
      description: err instanceof Error ? err.message : String(err),
    });
    return { stagehand: noopStagehand("stagehand init failed"), ai: false };
  }

  // Mirror the Playwright page's current URL onto the Stagehand browser so
  // `.act("click foo")` lands on the right screen.
  try {
    const url = page.url();
    if (url && url !== "about:blank") {
      const sgPage = instance.context.pages[0];
      await sgPage?.goto(url);
    }
  } catch {
    // best-effort
  }

  const wrapper: StagehandLike = {
    enabled: true,
    async act(instruction) {
      await instance.act(instruction);
    },
    async observe(instruction) {
      return instance.observe(instruction);
    },
    async extract<T = { extraction: string }>(instruction: string): Promise<T> {
      return (await instance.extract(instruction)) as T;
    },
    async close() {
      await instance.close({ force: false }).catch(() => undefined);
    },
  };

  return { stagehand: wrapper, ai: true };
}

function noopStagehand(reason: string): StagehandLike {
  const err = new Error(`Stagehand disabled: ${reason}`);
  return {
    enabled: false,
    async act() {
      throw err;
    },
    async observe() {
      throw err;
    },
    async extract() {
      throw err;
    },
    async close() {
      /* nothing to do */
    },
  };
}

/**
 * Helper to gate Stagehand-only tests: call at the top of a test block.
 */
export function skipWithoutAI(stagehand: StagehandLike): void {
  test.skip(
    !stagehand.enabled,
    "Stagehand disabled (set ANTHROPIC_API_KEY to enable AI-driven assertions)",
  );
}
