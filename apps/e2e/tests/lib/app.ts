import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "@playwright/test";

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

/**
 * Complete the DemoAuthBasicUI sign-up prompt. The component (jazz-tools 0.20)
 * renders a form with an `<input placeholder="Display name" />` and an
 * `<input type="submit" value="Sign up" />`; we locate both by their canonical
 * accessible properties and fall through if either one is missing.
 *
 * Exposed as a reusable helper so concurrent specs (smoke / invite /
 * rules-suggest) can share the same auth shortcut without duplicating the
 * selector logic when jazz-react ships a new basic UI.
 */
export async function completeDemoAuth(page: Page, name: string): Promise<void> {
  const input = page
    .getByPlaceholder("Display name")
    .or(page.getByLabel(/name|display/i))
    .or(page.locator("form input[type='text'], form input:not([type])"))
    .first();
  await input.waitFor({ state: "visible", timeout: 30_000 });
  await input.fill(name);

  const submit = page
    .locator("input[type='submit'][value='Sign up']")
    .or(page.getByRole("button", { name: /sign ?up|continue|create/i }))
    .first();
  await submit.click();
}

/**
 * Walk the first-run onboarding flow in demo/fixture mode:
 *   Welcome -> Name household -> Load fixture data (demo).
 *
 * After the fixture bank materializes its accounts, `Onboarding` calls
 * `onDone("dashboard")` which flips the app into the main shell; we wait for
 * the sidebar "Dashboard" nav button to appear so callers can proceed with
 * post-onboarding assertions immediately.
 */
export async function completeOnboardingWithFixture(
  page: Page,
  householdName: string,
): Promise<void> {
  // Step 1: Welcome card with a primary "Create my household" button.
  await page
    .getByRole("button", { name: /create my household/i })
    .click({ timeout: 30_000 });

  // Step 2: name the household. The input has a real <label for="household-name">.
  const nameInput = page
    .getByLabel(/household name/i)
    .or(page.locator("#household-name"))
    .first();
  await nameInput.waitFor({ state: "visible", timeout: 15_000 });
  await nameInput.fill(householdName);
  await page.getByRole("button", { name: /create household/i }).click();

  // Step 3: "Load demo bank" materializes the fixture Revolut accounts.
  const loadDemo = page.getByRole("button", { name: /load demo bank/i });
  await loadDemo.waitFor({ state: "visible", timeout: 15_000 });
  await loadDemo.click();

  // Onboarding posts "Loaded N demo account(s)..." then navigates to Dashboard
  // after ~700ms; the sidebar "Dashboard" nav button is the canonical signal.
  await expect(
    page.getByRole("button", { name: "Dashboard", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
}
