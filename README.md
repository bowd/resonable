# Resonable

Local-first household expense tracker with LLM-assisted labeling.
Built on [Jazz](https://jazz.tools) (CRDT sync), [GoCardless Bank Account Data](https://bankaccountdata.gocardless.com) (EU PSD2), and [Ollama](https://ollama.com) (local LLM).

- CRDT sync between household members; encrypted on-wire, no central authority holds data.
- Rules engine: deterministic first, LLM fallback, LLM-learned rules promoted back to deterministic.
- Revolut / N26 via GoCardless in the Tauri desktop build; CSV import as a fallback for unsupported banks.
- Append-only label overlays with author attribution for anti-griefing audit.
- Encrypted passphrase-based backup / restore.

## Requirements

- **Node** 22.x
- **pnpm** 10.x (`corepack enable` will pick up the pinned `packageManager` version)
- **Rust** stable (only for the native desktop build)
- **Ollama** running locally for LLM classification (`ollama pull llama3.2`)

Linux desktop build also needs system WebKit / GTK headers:

```bash
sudo apt-get install -y \
  libgtk-3-dev libwebkit2gtk-4.1-dev libsoup-3.0-dev \
  libjavascriptcoregtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev
```

## Repo layout

```
apps/
  desktop/           # Vite + React app, Tauri-ready
  desktop/src-tauri/ # Rust backend (keychain + GoCardless HTTP)
  e2e/               # Stagehand + Playwright integration tests
packages/
  schema/            # Jazz CoValue schemas (co.map / co.list)
  core/              # Pure TS: rule engine, pipeline, LLM adapters,
                     # GoCardless client, CSV parse/export, backup crypto
```

## First run (web dev mode with fixture data)

```bash
pnpm install
pnpm --filter @resonable/desktop dev
```

Open http://localhost:5173. Demo auth prompts for a display name.
The onboarding flow walks you through: create household → pick a data source → land on the Dashboard.
Picking "Load fixture data (demo)" materializes two sample bank accounts (Revolut / N26) without any network call.

Toggle demo vs. real mode in **Settings → Demo mode** (a `resonable.demo` flag in localStorage).

## Connect to a local LLM

Start Ollama and pull a model:

```bash
ollama serve   # usually already running as a daemon
ollama pull llama3.2
```

The app auto-detects `http://localhost:11434`. Override the URL or model name under **Settings → Local LLM**.

Features that use it:
- **Transactions → Run pipeline**: classifies uncategorized transactions.
- **Clusters → Suggest label**: names a merchant cluster.
- **Rules → Suggest rules**: derives a rule from labeled transactions (heuristic first, LLM fallback validates against negatives).

If Ollama is down, deterministic rules still run; LLM steps raise a visible error but do not break the UI.

## Desktop build (Tauri)

```bash
pnpm --filter @resonable/desktop tauri dev   # live-reloading window
pnpm --filter @resonable/desktop tauri build # produces platform bundles
```

Tauri mode stores GoCardless credentials in the OS keychain (via `keyring` crate) and calls `api.gocardless.com` directly from Rust \u2014 the web build can't do that because of CORS.

## Real GoCardless connection

1. Register a free app at https://bankaccountdata.gocardless.com/user/signup.
2. Get a `secret_id` and `secret_key` from the dashboard.
3. In the desktop (Tauri) build, open **Settings \u2192 Bank data** and paste the
   two secrets. They are stored in your OS keychain via the Rust
   `keyring` crate and never leave the device.
4. Back in **Accounts \u2192 Link Revolut / N26**, the first bank action will
   mint a token pair (verifying the credentials) and open the hosted consent
   page. After consenting in the browser, click **Check now** on the pending-
   requisition card (or wait for auto-poll to detect `LN`).
5. Transactions replicate to every household member via the Jazz sync peer.

Credentials never leave the device. Only short-lived access tokens can be optionally shared via the Jazz household Group so read-only members sync reads.

### Sandbox smoke test

GoCardless publishes a sandbox institution (`SANDBOXFINANCE_SFIN0000`) that auto-approves consent. Use it to verify the end-to-end flow without a real bank account:

```bash
GOCARDLESS_SECRET_ID=\u2026 GOCARDLESS_SECRET_KEY=\u2026 \
  pnpm --filter @resonable/core smoke:gocardless
```

The script mints a token, creates a requisition, prints a consent URL (complete it in any browser), polls until linked, fetches the first account's transactions, and deletes the requisition on exit.

## Household sync between devices

Households are Jazz Groups. Invite another person:

1. **Household \u2192 Generate invite** (pick reader or writer).
2. Send them the generated `resonable-invite:\u2026` string.
3. They paste it into the same input on their device; Jazz verifies and attaches them to the Group.

Sync relay defaults to the public Jazz Mesh (`wss://mesh.jazz.tools/...`).
Change the peer in **Settings \u2192 Sync**. Relays never see decrypted data.

## Encrypted backup / restore

**Settings \u2192 Backup \u2192 Export encrypted backup** prompts for a passphrase (>= 8 chars), emits `resonable-backup-YYYY-MM-DD.json`.
AES-256-GCM + PBKDF2-SHA256 (600k iterations, random salt, random IV).
Restore is a merge: duplicate accounts / transactions dedupe by `externalId`; categories / tags match by name; rules by `name + spec`.

An unencrypted export option exists for debugging and is clearly labelled.

## Development commands

```bash
pnpm -r typecheck                       # all workspaces
pnpm --filter @resonable/core test       # 66 unit + integration tests
pnpm --filter @resonable/desktop build   # vite production bundle
pnpm --filter @resonable/desktop dev     # dev server on :5173
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

### End-to-end

```bash
pnpm --filter @resonable/e2e install-browsers   # one-time, ~300MB
pnpm --filter @resonable/e2e test:e2e
```

Stagehand uses `ANTHROPIC_API_KEY` when present for AI-driven actions, falls back to pure Playwright selectors when not.

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs typecheck, core tests, desktop build, and `cargo check` on push and PR.

## macOS release builds

Trigger the `Release (macOS)` workflow manually from the Actions tab. It runs on both Apple Silicon (`macos-latest`) and Intel (`macos-13`) runners and produces unsigned `.app` + `.dmg` bundles uploaded as workflow artifacts (`resonable-macos-arm64`, `resonable-macos-x86_64`).

Optional inputs:
- `version` \u2014 stamped into `tauri.conf.json` and `Cargo.toml` before the build.
- `bundles` \u2014 comma-separated tauri bundle targets (default `app,dmg`).

Code signing / notarization are deliberately not wired up; add `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` as repo secrets and read them in the cargo tauri build step when you're ready.

## License

Not yet declared.
