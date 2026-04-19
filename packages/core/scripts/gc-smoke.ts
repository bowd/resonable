/* eslint-disable no-console */
/**
 * GoCardless sandbox smoke test.
 *
 * Exercises the real GoCardlessClient end-to-end:
 *   - mint / refresh access token
 *   - list institutions for a country
 *   - create a requisition for the "Sandbox Finance" test institution
 *   - prompt the user to complete consent in a browser
 *   - poll requisition until status=LN
 *   - fetch transactions for the first returned account
 *
 * GoCardless publishes a sandbox test bank at institution id
 * "SANDBOXFINANCE_SFIN0000" that auto-approves any consent, so this
 * script can be run without a real bank login.
 *
 * Usage:
 *   GOCARDLESS_SECRET_ID=... GOCARDLESS_SECRET_KEY=... \
 *     pnpm --filter @resonable/core tsx scripts/gc-smoke.ts
 *
 * Register a free app at:
 *   https://bankaccountdata.gocardless.com/user/signup
 */

import { GoCardlessClient, normalize } from "../src/index";

const SECRET_ID = process.env.GOCARDLESS_SECRET_ID;
const SECRET_KEY = process.env.GOCARDLESS_SECRET_KEY;
const INSTITUTION = process.env.GC_INSTITUTION_ID ?? "SANDBOXFINANCE_SFIN0000";
const COUNTRY = process.env.GC_COUNTRY ?? "GB";
const REDIRECT = process.env.GC_REDIRECT_URL ?? "https://example.com/oauth/callback";
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

async function main(): Promise<void> {
  if (!SECRET_ID || !SECRET_KEY) {
    console.error(
      "Missing env vars. Set GOCARDLESS_SECRET_ID and GOCARDLESS_SECRET_KEY to your\n" +
        "GoCardless Bank Account Data credentials (https://bankaccountdata.gocardless.com).",
    );
    process.exit(2);
  }

  const client = new GoCardlessClient({
    credentials: { secretId: SECRET_ID, secretKey: SECRET_KEY },
    onTokenRefreshed: (pair) => {
      console.log(`\u2713 token refreshed \u2014 access expires ${pair.accessExpiresAt}`);
    },
  });

  console.log(`\u2192 requesting access token\u2026`);
  await client.ensureAccessToken();

  console.log(`\u2192 listing institutions in ${COUNTRY}\u2026`);
  const institutions = await client.listInstitutions(COUNTRY);
  console.log(`  found ${institutions.length} institutions`);
  const hit = institutions.find((i) => i.id === INSTITUTION);
  if (!hit) {
    console.error(`  institution ${INSTITUTION} not available in ${COUNTRY}. Available ids:`);
    for (const i of institutions.slice(0, 8)) console.error(`    - ${i.id} \u2014 ${i.name}`);
    process.exit(3);
  }
  console.log(`  using ${hit.id} \u2014 ${hit.name}`);

  console.log(`\u2192 creating requisition\u2026`);
  const req = await client.createRequisition({
    institutionId: INSTITUTION,
    redirectUrl: REDIRECT,
    reference: `resonable-smoke-${Date.now()}`,
  });
  console.log(`  requisition id: ${req.id}`);
  console.log(`\n  \u25BA Open this URL in a browser to complete consent:\n    ${req.link}\n`);
  console.log(`  The sandbox institution auto-approves; real banks require your login.\n`);

  console.log(`\u2192 polling requisition until status=LN (timeout ${POLL_TIMEOUT_MS / 1000}s)\u2026`);
  const started = Date.now();
  let status = await client.getRequisition(req.id);
  while (status.status !== "LN") {
    if (Date.now() - started > POLL_TIMEOUT_MS) {
      console.error(`  timed out while waiting for consent. last status: ${status.status}`);
      process.exit(4);
    }
    if (status.status === "RJ" || status.status === "EX") {
      console.error(`  terminal status ${status.status} \u2014 consent was rejected or expired.`);
      process.exit(5);
    }
    await sleep(POLL_INTERVAL_MS);
    status = await client.getRequisition(req.id);
    console.log(`  status=${status.status} (${Math.floor((Date.now() - started) / 1000)}s)`);
  }

  if (status.accounts.length === 0) {
    console.error(`  requisition linked but no accounts returned. bailing.`);
    process.exit(6);
  }
  console.log(`\u2713 linked. ${status.accounts.length} account(s): ${status.accounts.join(", ")}`);

  const accountId = status.accounts[0]!;
  console.log(`\u2192 fetching transactions for ${accountId}\u2026`);
  const txs = await client.listTransactions(accountId);
  const booked = txs.transactions.booked;
  console.log(`  ${booked.length} booked transactions`);
  const sample = booked.slice(0, 5).map((t) => normalize(t));
  for (const s of sample) {
    const amt = (s.amountMinor / 100).toFixed(2).padStart(9);
    console.log(`  ${s.bookedAt.slice(0, 10)}  ${amt} ${s.currency}  ${s.counterparty ?? "\u2014"}`);
  }

  console.log(`\n\u2713 GoCardless smoke test complete.`);
  console.log(`  cleanup: deleting requisition ${req.id}\u2026`);
  await client.deleteRequisition(req.id);
  console.log(`  done.`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
