import { expect, test, type Page } from "@playwright/test";
import {
  bootstrapDemo,
  completeDemoAuth,
  completeOnboardingWithFixture,
  newStagehand,
} from "./lib/app";

/**
 * Happy-path smoke test for the Resonable desktop app, driven through the Vite
 * dev server in fixture/demo mode.
 *
 * Invariants exercised (all with strict Playwright assertions):
 *   1. Demo auth completes with a chosen display name.
 *   2. Three-step onboarding reaches the dashboard via "Load fixture data".
 *   3. Dashboard's "Total spend" StatCard renders a non-zero numeric value.
 *   4. Accounts tab shows the Revolut + N26 fixture institutions.
 *   5. Transactions tab carries at least one Netflix row already labeled as
 *      "Subscriptions" (the starter "Streaming subscriptions" rule should
 *      fire automatically during first import).
 *   6. CSV import and Settings > Backup views render without crashing.
 *
 * Stagehand's natural-language `.act()` is reserved for steps where DOM churn
 * is most likely (the jazz-tools auth prompt + sidebar nav); strict Playwright
 * assertions cover every *semantic* invariant we care about. When
 * `ANTHROPIC_API_KEY` is absent, `newStagehand` returns `ai: false` and every
 * step falls back to pure Playwright selectors.
 */
test("happy path: onboarding -> fixtures -> dashboard -> transactions", async ({ page }, testInfo) => {
  await bootstrapDemo(page);
  const { stagehand, ai } = await newStagehand(page, testInfo);

  await page.goto("/");

  // --- 1. Demo auth -------------------------------------------------------
  const displayName = "Smoke User";
  if (ai) {
    try {
      await stagehand.act(
        `In the Resonable sign-in form, type "${displayName}" into the "Display name" field and click the "Sign up" submit button.`,
      );
      // Stagehand drives a separate browser; we still need to complete auth
      // on the Playwright-controlled page the rest of the test uses.
      await completeDemoAuth(page, displayName);
    } catch (err) {
      testInfo.annotations.push({
        type: "stagehand-act-fallback",
        description: `auth flow: ${(err as Error).message}`,
      });
      await completeDemoAuth(page, displayName);
    }
  } else {
    await completeDemoAuth(page, displayName);
  }

  // --- 2. Onboarding with fixture data ------------------------------------
  await completeOnboardingWithFixture(page, "Smoke Household");

  // Sanity: the sidebar rendered with the household mode pill present.
  await expect(page.getByRole("heading", { name: /^Resonable/ }))
    .toBeVisible({ timeout: 15_000 });

  // --- 3. Dashboard: non-zero Total spend ---------------------------------
  await clickNav(page, "Dashboard");
  // Match the exact label text inside the muted <div> rendered by StatCard;
  // constraining with hasText + a regex anchored at start avoids sub-matches.
  const spendCard = page
    .locator(".card", { hasText: /^Total spend/ })
    .first();
  await expect(spendCard).toBeVisible({ timeout: 15_000 });

  // Fixture data has plenty of spend, but the value formatting is locale-
  // dependent (e.g. "€1,234.56" vs "1.234,56 €"). Assert there's at least one
  // non-zero digit and a EUR indicator — either the € glyph or the ISO code.
  const spendText = (await spendCard.textContent()) ?? "";
  expect(spendText, "Total spend card should render a non-zero number").toMatch(/[1-9]/);
  expect(spendText, "Total spend card should be denominated in EUR").toMatch(/€|EUR/);

  // --- 4. Accounts tab: Revolut + N26 both present ------------------------
  await clickNav(page, "Accounts");
  // Fixture bootstrap only links Revolut (`REVOLUT_REVOLT21`), which under the
  // hood exposes accounts labeled "Revolut" and "N26" (multi-institution demo
  // fixture). Either way, both names should appear as account card text.
  await expect(
    page.getByRole("heading", { name: /Accounts in Smoke Household/i }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".card").filter({ hasText: /Revolut/ }).first())
    .toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".card").filter({ hasText: /N26/ }).first())
    .toBeVisible({ timeout: 15_000 });

  // --- 5. Transactions tab: Netflix row labeled "Subscriptions" -----------
  await clickNav(page, "Transactions");

  // "N of M transactions" is the canonical count readout from FilterBar.
  const counter = page.getByText(/^\d+ of \d+ transactions$/).first();
  await expect(counter).toBeVisible({ timeout: 30_000 });
  const counterText = (await counter.textContent()) ?? "";
  const total = Number(counterText.match(/of (\d+) transactions/)?.[1] ?? "0");
  expect(total, "Transaction list should not be empty").toBeGreaterThan(0);

  // Narrow to Netflix via the search input.
  const searchInput = page.getByPlaceholder(/Search counterparty or description/i);
  await searchInput.fill("Netflix");

  // The Row for Netflix contains the counterparty as a <strong>, and its
  // category <select> has "Subscriptions" as its selected option because the
  // "Streaming subscriptions" starter rule matches "netflix" during import.
  const netflixRow = page.locator(".row").filter({ hasText: /netflix/i }).first();
  await expect(netflixRow).toBeVisible({ timeout: 15_000 });

  const netflixCategory = await firstRowSelectedCategory(page, /netflix/i);
  expect(netflixCategory, "Netflix row should be categorized").not.toBeNull();
  expect(netflixCategory ?? "").toMatch(/subscriptions/i);

  // Clear search before leaving so the next view renders without residual
  // filter state.
  await searchInput.fill("");

  // --- 6. CSV import + Settings > Backup render without crashing ----------
  await clickNav(page, "CSV import");
  await expect(
    page.getByRole("heading", { name: /^Import CSV$/ }),
  ).toBeVisible({ timeout: 15_000 });

  await clickNav(page, "Settings");
  await expect(
    page.getByRole("heading", { name: /^Settings$/ }),
  ).toBeVisible({ timeout: 15_000 });
  // The Backup section is rendered as a <strong>Backup</strong> heading inside
  // a card. getByText with exact:true pins us to the label rather than any
  // stray "Backup file (.json)" affordance.
  await expect(page.getByText("Backup", { exact: true })).toBeVisible();

  await stagehand.close();
});

/**
 * Click a sidebar nav button by its visible label. `App.tsx` renders them as
 * plain `<button>` elements, so the accessible-name match is stable.
 */
async function clickNav(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: label, exact: true }).click();
}

/**
 * Given the Transactions list, return the currently-selected label of the
 * category <select> inside the first row whose text matches `pattern`.
 *
 * Returns `null` when no matching row is found or when the row has no
 * `<select>` (e.g. pre-import placeholder state). Runs entirely in the page
 * context so we can read `HTMLSelectElement.selectedOptions[0].text` directly.
 */
async function firstRowSelectedCategory(
  page: Page,
  pattern: RegExp,
): Promise<string | null> {
  const source = pattern.source;
  const flags = pattern.flags;
  return page.evaluate(
    ({ source, flags }) => {
      const re = new RegExp(source, flags);
      const rows = Array.from(document.querySelectorAll(".row")) as HTMLElement[];
      const match = rows.find((r) => re.test(r.textContent ?? ""));
      if (!match) return null;
      const sel = match.querySelector("select") as HTMLSelectElement | null;
      if (!sel) return null;
      const opt = sel.options[sel.selectedIndex];
      return opt?.text ?? null;
    },
    { source, flags },
  );
}
