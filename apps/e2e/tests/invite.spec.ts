import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { bootstrapDemo } from "./lib/app";

/**
 * Multi-context household-invite test.
 *
 * Two isolated Playwright contexts act as separate devices:
 *   - Alice (host)  owns "Shared" and has already loaded the demo Revolut +
 *     N26 fixtures so the accounts list is meaningful.
 *   - Bob   (guest) is fresh; he is forced through Onboarding (which has no
 *     "join with invite" affordance in the current UI), so he creates a
 *     throwaway household to get past it, then pastes Alice's invite token
 *     on the Household tab.
 *
 * After acceptance, we assert that "Shared" shows up in Bob's household list
 * and that Alice's Revolut + N26 accounts replicate into Bob's Accounts tab
 * via Jazz sync. Replication is eventual, so the assertions use long
 * timeouts (up to 30s) to tolerate a slow mesh relay on CI.
 */

test("invite: Bob joins Alice's household across two browser contexts", async ({ browser }) => {
  test.setTimeout(120_000);

  // --- Alice (host) ---------------------------------------------------------
  const aliceCtx = await browser.newContext();
  const bobCtx = await browser.newContext();

  try {
    const alice = await aliceCtx.newPage();
    await bootstrapDemo(alice);
    await alice.goto("/");

    await completeDemoAuth(alice, "Alice");
    // After auth, an account with no households lands on Onboarding (step 1).
    await runOnboardingCreateHousehold(alice, "Shared", { loadDemoBank: true });

    // Post-onboarding the app navigated to Dashboard; now also link N26 so
    // Bob sees both Revolut and N26 after sync.
    await expect(alice.getByRole("button", { name: "Dashboard" })).toBeVisible({ timeout: 30_000 });
    await clickNav(alice, "Accounts");
    await alice.getByRole("button", { name: "Link N26" }).click();
    await expect(alice.getByText(/Linked \d+ account\(s\) with fixture data\./)).toBeVisible({
      timeout: 30_000,
    });

    // Generate a writer invite on the Household tab.
    await clickNav(alice, "Household");
    await expect(alice.getByText("Shared")).toBeVisible();

    // The role selector sits right next to the "Generate invite" button and
    // defaults to "writer" in the UI; set it explicitly in case the default
    // changes. We pick the <select> that lives in the same row as the
    // Generate-invite button to avoid clashing with the per-member role
    // selects inside the Members list.
    const inviteRow = alice
      .locator("label", { hasText: /invite a housemate/i })
      .locator("xpath=following-sibling::div[1]");
    await inviteRow.locator("select").selectOption("writer");

    await alice.getByRole("button", { name: /generate invite/i }).click();

    const inviteArea = alice.locator("textarea[readonly]");
    await expect(inviteArea).toBeVisible({ timeout: 15_000 });
    const token = (await inviteArea.inputValue()).trim();
    expect(token).toMatch(/^resonable-invite:/);

    // --- Bob (guest) --------------------------------------------------------
    const bob = await bobCtx.newPage();
    await bootstrapDemo(bob);
    await bob.goto("/");

    await completeDemoAuth(bob, "Bob");

    // The current Onboarding flow has no "join with invite" affordance, so
    // Bob creates a throwaway household to get past it, then pastes Alice's
    // invite on the Household tab.
    await runOnboardingCreateHousehold(bob, "Bob Placeholder", { loadDemoBank: false });

    await expect(bob.getByRole("button", { name: "Dashboard" })).toBeVisible({ timeout: 30_000 });
    await clickNav(bob, "Household");

    // Paste the invite into the "Accept an invite" input and click Join.
    const inviteInput = bob.getByPlaceholder(/resonable-invite:/i);
    await expect(inviteInput).toBeVisible();
    await inviteInput.fill(token);
    await bob.getByRole("button", { name: "Join", exact: true }).click();

    // Alice's "Shared" household should replicate into Bob's list. Jazz sync
    // over the public mesh relay can take a moment on first connect.
    await expect(bob.getByText("Shared", { exact: true })).toBeVisible({ timeout: 30_000 });
    // Sanity: Bob's placeholder household is still there too.
    await expect(bob.getByText("Bob Placeholder", { exact: true })).toBeVisible();

    // Navigate to Accounts. The view shows "Accounts in <householdName>" for
    // the first household only; to look at Shared's accounts we select it
    // implicitly by the heading it renders. The fixture account names come
    // from packages/core/src/platform/fixture.ts (Revolut EUR, N26 Main).
    await clickNav(bob, "Accounts");

    // useFirstHousehold picks whichever HouseholdRef loads first, which may be
    // either. Wait until the view shows Alice's Revolut + N26 accounts; if
    // the placeholder household is rendered first, its Accounts list is
    // empty, so the fixture strings won't appear there anyway.
    await expect(bob.getByText(/Revolut EUR/)).toBeVisible({ timeout: 30_000 });
    await expect(bob.getByText(/N26 Main/)).toBeVisible({ timeout: 30_000 });
  } finally {
    await aliceCtx.close();
    await bobCtx.close();
  }
});

/**
 * DemoAuthBasicUI shows a "name + sign up" form on first launch in a fresh
 * storage partition. We use the most stable locators (a text input plus a
 * "Sign up / Continue / Create" button) because the exact DOM has drifted
 * across jazz-tools versions. Kept local to this spec so the shared
 * `lib/app.ts` stays small while a sibling agent edits it in parallel.
 */
async function completeDemoAuth(page: Page, name: string): Promise<void> {
  const input = page
    .getByLabel(/name|display/i)
    .or(page.locator("input[type='text']"))
    .first();
  await input.waitFor({ state: "visible", timeout: 30_000 });
  await input.fill(name);
  const submit = page
    .getByRole("button", { name: /sign ?up|continue|create/i })
    .first();
  await submit.click();
}

/**
 * Walk the 3-step Onboarding flow: click through the welcome step, enter the
 * household name, optionally load the demo bank fixture on step 3, and then
 * either wait for the auto-redirect to dashboard (when the demo bank loads)
 * or click "Skip for now".
 */
async function runOnboardingCreateHousehold(
  page: Page,
  householdName: string,
  opts: { loadDemoBank: boolean },
): Promise<void> {
  // Step 1: welcome screen.
  await page.getByRole("button", { name: /create my household/i }).click();

  // Step 2: name the household.
  const nameInput = page.getByLabel(/household name/i);
  await expect(nameInput).toBeVisible({ timeout: 15_000 });
  await nameInput.fill(householdName);
  await page.getByRole("button", { name: /create household/i }).click();

  // Step 3: bring in transactions.
  if (opts.loadDemoBank) {
    await page.getByRole("button", { name: /load demo bank/i }).click();
    // The inline handler auto-navigates to Dashboard after ~700ms; wait for
    // the sidebar to confirm we've left the onboarding view.
    await expect(page.getByRole("button", { name: "Dashboard" })).toBeVisible({
      timeout: 30_000,
    });
  } else {
    await page.getByRole("button", { name: /skip for now/i }).click();
  }
}

/**
 * Sidebar nav is rendered as plain `<button>`s addressed by accessible name.
 * Local copy (rather than shared) to keep this spec self-contained.
 */
async function clickNav(page: Page, label: string) {
  await page.getByRole("button", { name: label, exact: true }).click();
}

