import { expect, test, type Page } from "@playwright/test";
import { bootstrapDemo, newStagehand } from "./lib/app";

/**
 * Rule-suggestion flow. Verifies the deterministic learning loop:
 *   1. User labels a handful of BILLA rows as "Groceries" on the Transactions
 *      tab (per-row <select> writes a source="user" TransactionLabel overlay).
 *   2. Rules tab's "Suggest rules from labeled transactions" panel runs the
 *      heuristic LCS proposer, which locks onto "BILLA" as a counterparty
 *      substring across the fixture rows (rv-003 + rv-004 share the prefix).
 *   3. Clicking Accept on the proposal creates an "Auto: Groceries" rule and
 *      the proposal is removed from the panel.
 *
 * The heuristic path runs without any LLM, so the main assertion path does
 * NOT require ANTHROPIC_API_KEY or Ollama. Stagehand `.act()` is used only
 * for the noisier nav/auth steps when it's available; everything
 * load-bearing uses strict Playwright selectors.
 */
test("rule suggestions: label BILLA rows -> suggest -> accept new rule", async ({ page }, testInfo) => {
  await bootstrapDemo(page);
  const { stagehand, ai } = await newStagehand(page, testInfo);

  await page.goto("/");

  // 1. Complete demo auth.
  const displayName = "Rules User";
  if (ai) {
    try {
      await stagehand.act(
        `In the Resonable sign-in form, type "${displayName}" into the name field and click the primary continue/sign-up button.`,
      );
    } catch (err) {
      testInfo.annotations.push({
        type: "stagehand-act-fallback",
        description: `auth flow: ${(err as Error).message}`,
      });
      await plainAuth(page, displayName);
    }
  } else {
    await plainAuth(page, displayName);
  }

  // 2. Onboarding: name the household and load fixture data. The app gates
  //    on "no household yet" and shows the 3-step Onboarding flow, so we
  //    navigate that rather than using Household.tsx's "New household" form.
  await page.getByRole("button", { name: /create my household/i }).click();
  const nameInput = page.getByLabel(/household name/i);
  await expect(nameInput).toBeVisible({ timeout: 15_000 });
  await nameInput.fill("Learning Household");
  await page.getByRole("button", { name: /create household/i }).click();
  // Step 3: load demo fixture bank so BILLA/Hofer/Netflix rows exist.
  await page.getByRole("button", { name: /load demo bank/i }).click();
  // Onboarding auto-navigates to Dashboard once the fixtures materialize.
  await expect(page.getByRole("button", { name: "Dashboard" })).toBeVisible({ timeout: 30_000 });

  // 3. Transactions tab. Filter to BILLA and label the first two rows
  //    Groceries via the per-row <select>.
  await clickNav(page, "Transactions");
  const counter = page.getByText(/^\d+ of \d+ transactions$/);
  await expect(counter).toBeVisible({ timeout: 30_000 });

  const search = page.getByPlaceholder(/Search counterparty or description/i);
  await search.fill("BILLA");

  // Wait for at least two BILLA rows to show (fixture has rv-003 + rv-004).
  const billaRows = page.locator(".row", { hasText: /billa/i });
  await expect(billaRows.nth(1)).toBeVisible({ timeout: 15_000 });
  const billaCount = await billaRows.count();
  expect(billaCount, "fixture should supply at least two BILLA rows").toBeGreaterThanOrEqual(2);

  // The per-row category <select> lives inside each .row. We pick the option
  // by visible text; "Groceries" is one of the starter categories seeded by
  // createHouseholdWithStarters.
  for (let i = 0; i < Math.min(2, billaCount); i++) {
    const row = billaRows.nth(i);
    const select = row.locator("select").first();
    await select.selectOption({ label: "Groceries" });
  }

  // Confirm the overlay took: both BILLA rows now show Groceries in the
  // <select>. Use a DOM probe since the option text is hidden inside the
  // native control.
  const selectedLabels = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll(".row")) as HTMLElement[];
    return rows
      .filter((r) => /billa/i.test(r.textContent ?? ""))
      .map((r) => {
        const sel = r.querySelector("select") as HTMLSelectElement | null;
        return sel?.options[sel.selectedIndex]?.text ?? null;
      });
  });
  expect(selectedLabels.filter((t) => t && /groceries/i.test(t)).length).toBeGreaterThanOrEqual(2);

  // 4. Rules tab. Click the "Run" button inside the suggest panel (the panel
  //    is introduced by the "Suggest rules from labeled transactions" heading).
  await search.fill("");
  await clickNav(page, "Rules");

  const suggestCard = page
    .locator(".card", { hasText: /suggest rules from labeled transactions/i })
    .first();
  await expect(suggestCard).toBeVisible({ timeout: 15_000 });
  await suggestCard.getByRole("button", { name: /^run$/i }).click();

  // Proposals render as nested .card elements inside the suggest panel.
  // Filter to the proposal whose header shows Groceries. The heuristic
  // proposer is synchronous + fast but still async (awaited), so allow a
  // short wait.
  const groceryProposal = suggestCard
    .locator(".card", { hasText: /groceries/i })
    .first();
  await expect(groceryProposal).toBeVisible({ timeout: 20_000 });

  // "supports N transactions" with N >= 2, and a source pill of heuristic/llm.
  await expect(groceryProposal).toContainText(/supports\s+(?:[2-9]|\d{2,})\s+transactions/i);
  await expect(groceryProposal.locator(".pill")).toHaveText(/heuristic|llm/i);

  // 5. Accept the proposal. The handler creates a Rule with
  //    name = `Auto: <categoryName>` and filters the proposal out of state.
  await groceryProposal.getByRole("button", { name: /^accept$/i }).click();

  // Proposal should vanish from the suggest panel.
  await expect(
    suggestCard.locator(".card", { hasText: /groceries/i }),
  ).toHaveCount(0, { timeout: 10_000 });

  // 6. The new rule appears in the Rules list with name starting "Auto: Groceries".
  //    Scope outside the suggest panel to avoid matching the disappeared
  //    proposal card (which ALSO said "Groceries"). The list's rule cards
  //    live as siblings of suggestCard under the same parent.
  const newRuleCard = page
    .locator(".card", { hasText: /^\s*Auto:\s*Groceries/i })
    .first();
  await expect(newRuleCard).toBeVisible({ timeout: 10_000 });
  await expect(newRuleCard).toContainText(/derived|llm/i); // the source pill

  await stagehand.close();
});

/**
 * Plain-Playwright auth fallback (mirrors smoke.spec.ts).
 */
async function plainAuth(page: Page, name: string) {
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

async function clickNav(page: Page, label: string) {
  await page.getByRole("button", { name: label, exact: true }).click();
}
