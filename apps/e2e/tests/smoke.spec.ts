import { expect, test } from "@playwright/test";
import { bootstrapDemo, newStagehand } from "./lib/app";

/**
 * Happy-path smoke test for the Resonable desktop app, driven through the Vite
 * dev server in fixture/demo mode. Stagehand's natural-language `.act()` is
 * used for the parts where DOM churn is most likely (auth prompt + tab
 * navigation); strict Playwright assertions cover the invariants we care about
 * semantically (row count, category name, dashboard total).
 *
 * When `ANTHROPIC_API_KEY` is absent, the Stagehand wrapper is disabled and
 * the test falls back to plain Playwright selectors end-to-end.
 */
test("happy path: auth -> household -> link bank -> classify -> dashboard", async ({ page }, testInfo) => {
  await bootstrapDemo(page);
  const { stagehand, ai } = await newStagehand(page, testInfo);

  await page.goto("/");

  // 1. DemoAuthBasicUI prompts for a display name on first launch. Its exact
  //    DOM has changed across jazz-react versions, so let Stagehand handle it
  //    when available; otherwise fall back to the canonical name input + submit.
  const name = "Test User";
  if (ai) {
    try {
      await stagehand.act(`In the Resonable sign-in form, type "${name}" into the name field and click the primary continue/sign-up button.`);
    } catch (err) {
      testInfo.annotations.push({
        type: "stagehand-act-fallback",
        description: `auth flow: ${(err as Error).message}`,
      });
      await plainAuth(page, name);
    }
  } else {
    await plainAuth(page, name);
  }

  // Sidebar nav renders only after auth completes.
  await expect(page.getByRole("button", { name: "Dashboard" })).toBeVisible({ timeout: 30_000 });

  // 2. Create "Smoke Household".
  await clickNav(page, "Household");
  await page.getByRole("button", { name: /new household/i }).click();
  await page.getByLabel(/household name/i).fill("Smoke Household");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText("Smoke Household")).toBeVisible();

  // 3. Accounts tab -> Link Revolut (fixture mode materializes immediately).
  await clickNav(page, "Accounts");
  await page.getByRole("button", { name: "Link Revolut" }).click();
  await expect(page.getByText(/Linked \d+ account\(s\) with fixture data\./)).toBeVisible({
    timeout: 30_000,
  });

  // 4. Transactions tab -> at least one row, and Netflix is categorized Subscriptions.
  await clickNav(page, "Transactions");
  // The "N of M transactions" footer is the canonical count readout.
  const counter = page.getByText(/^\d+ of \d+ transactions$/);
  await expect(counter).toBeVisible({ timeout: 30_000 });
  const counterText = (await counter.textContent()) ?? "";
  const total = Number(counterText.match(/of (\d+) transactions/)?.[1] ?? "0");
  expect(total).toBeGreaterThan(0);

  // Narrow the list to Netflix via the search input, then assert the Row's
  // embedded <select> shows "Subscriptions" as the picked option (the starter
  // "Streaming subscriptions" rule applies automatically during import).
  const searchInput = page.getByPlaceholder(/Search counterparty or description/i);
  await searchInput.fill("Netflix");
  const netflixRow = page.locator(".row", { hasText: /netflix/i }).first();
  await expect(netflixRow).toBeVisible({ timeout: 15_000 });

  // Each row contains a category <select>; assert its currently selected label.
  const netflixCategory = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll(".row")) as HTMLElement[];
    const match = rows.find((r) => /netflix/i.test(r.textContent ?? ""));
    if (!match) return null;
    const sel = match.querySelector("select") as HTMLSelectElement | null;
    if (!sel) return null;
    const opt = sel.options[sel.selectedIndex];
    return opt?.text ?? null;
  });
  expect(netflixCategory, "Netflix row should be categorized").toBeTruthy();
  expect(netflixCategory).toMatch(/subscriptions/i);

  // 5. Dashboard: total spend is non-zero. Format is locale-dependent, so we
  //    accept any digit run (optionally with a currency glyph or code).
  await searchInput.fill(""); // clear filter so dashboard re-renders cleanly
  await clickNav(page, "Dashboard");
  const spendCard = page.locator(".card", { hasText: /^Total spend/ }).first();
  await expect(spendCard).toBeVisible({ timeout: 15_000 });
  const spendText = (await spendCard.textContent()) ?? "";
  expect(spendText, "Total spend card should render a number").toMatch(/[1-9]/);

  await stagehand.close();
});

/**
 * Plain-Playwright auth fallback used when Stagehand is disabled. Uses the
 * most stable locators exposed by DemoAuthBasicUI (an input + a "Sign up"
 * button). Kept resilient: tries label match first, input[type=text] second.
 */
async function plainAuth(page: import("@playwright/test").Page, name: string) {
  const candidateInput = page
    .getByLabel(/name|display/i)
    .or(page.locator("input[type='text']"))
    .first();
  await candidateInput.waitFor({ state: "visible", timeout: 30_000 });
  await candidateInput.fill(name);
  const submit = page
    .getByRole("button", { name: /sign ?up|continue|create/i })
    .first();
  await submit.click();
}

/**
 * Click one of the sidebar nav buttons. They render as plain `<button>`s so
 * we address them by accessible name.
 */
async function clickNav(page: import("@playwright/test").Page, label: string) {
  await page.getByRole("button", { name: label, exact: true }).click();
}
