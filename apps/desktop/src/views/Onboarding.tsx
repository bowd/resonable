import { useState } from "react";
import type { LoadedHousehold, ResonableAccount } from "@resonable/schema";
import { fixtureBank, platform } from "../platform";
import { createHouseholdWithStarters } from "../data/household-setup";
import { importAccountForConnection } from "../data/import";

type Step = 1 | 2 | 3;

export type OnboardingNavTarget = "dashboard" | "accounts" | "import";

export type OnboardingProps = {
  /**
   * Called when onboarding finishes. The caller decides which tab to land on;
   * by the time this fires the user has at least one household attached to
   * their profile (step 2 always creates one).
   */
  onDone: (landing: OnboardingNavTarget) => void;
  me: ResonableAccount;
};

/**
 * Three-step first-run flow shown only when the user has no households yet.
 * Step 1: welcome + pitch. Step 2: name the household (creates it via the
 * shared helper). Step 3: prompt to bring in transactions.
 */
export function Onboarding({ onDone, me }: OnboardingProps) {
  const [step, setStep] = useState<Step>(1);
  const [householdName, setHouseholdName] = useState("Home");
  const demo = !!fixtureBank();

  function handleCreateHousehold() {
    if (!me.$isLoaded) return;
    const name = householdName.trim() || "Home";
    // Same code path as Household.tsx "+ New household" via the shared helper.
    createHouseholdWithStarters(me, name);
    setStep(3);
  }

  return (
    <div style={rootStyle}>
      <div style={{ width: "min(640px, 100%)" }}>
        <ProgressIndicator step={step} />
        {step === 1 && <WelcomeStep onNext={() => setStep(2)} />}
        {step === 2 && (
          <NameHouseholdStep
            value={householdName}
            onChange={setHouseholdName}
            onCreate={handleCreateHousehold}
            onBack={() => setStep(1)}
          />
        )}
        {step === 3 && (
          <BringTransactionsStep me={me} demo={demo} onDone={onDone} />
        )}
      </div>
    </div>
  );
}

const rootStyle: React.CSSProperties = {
  padding: "48px 24px",
  display: "flex",
  justifyContent: "center",
  alignItems: "flex-start",
  minHeight: "100vh",
  boxSizing: "border-box",
};

function ProgressIndicator({ step }: { step: Step }) {
  const segments: Step[] = [1, 2, 3];
  return (
    <div style={{ marginBottom: 24 }}>
      <div className="muted" style={{ marginBottom: 6 }}>
        Step {step} of 3
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {segments.map((s) => (
          <div
            key={s}
            aria-current={s === step ? "step" : undefined}
            style={{
              flex: 1,
              height: 6,
              borderRadius: 3,
              background: s <= step ? "var(--accent)" : "var(--border)",
              transition: "background 150ms",
            }}
          />
        ))}
      </div>
    </div>
  );
}

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Welcome to Resonable</h2>
      <p>
        Resonable is a local-first household expense tracker with smart LLM
        labels: your transactions stay on your devices and suggestions come from
        a local model you control.
      </p>
      <p className="muted">
        Running in <strong>{platform.mode}</strong> mode.{" "}
        {platform.mode === "fixture"
          ? "Demo mode uses built-in Revolut/N26 sample data with no network calls, so you can explore everything without linking a real bank."
          : platform.mode === "tauri"
          ? "Desktop build: secrets live in your OS keychain and requests go directly to GoCardless."
          : "Broker mode: your self-hosted proxy handles GoCardless requests."}
      </p>
      <div style={{ marginTop: 16 }}>
        <button className="primary" onClick={onNext}>
          Create my household
        </button>
      </div>
    </div>
  );
}

function NameHouseholdStep(props: {
  value: string;
  onChange: (v: string) => void;
  onCreate: () => void;
  onBack: () => void;
}) {
  const { value, onChange, onCreate, onBack } = props;
  const trimmed = value.trim();
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Name your household</h2>
      <p className="muted">
        A household is a shared workspace. You can rename it later and invite
        housemates with reader or writer access.
      </p>
      <label htmlFor="household-name">Household name</label>
      <input
        id="household-name"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Home"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter" && trimmed) onCreate();
        }}
      />
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <button className="primary" disabled={!trimmed} onClick={onCreate}>
          Create household
        </button>
        <button onClick={onBack}>Back</button>
      </div>
    </div>
  );
}

function BringTransactionsStep(props: {
  me: ResonableAccount;
  demo: boolean;
  onDone: (landing: OnboardingNavTarget) => void;
}) {
  const { me, demo, onDone } = props;
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function loadFixtureInline() {
    if (!me.$isLoaded) return;
    const profile = me.profile;
    if (!profile || !profile.$isLoaded) return;
    // Step 2 just pushed a HouseholdRef; grab the first loaded one.
    let household: LoadedHousehold | null = null;
    for (const ref of profile.households as unknown as ReadonlyArray<{
      household: LoadedHousehold;
    }>) {
      if (ref?.household) {
        household = ref.household;
        break;
      }
    }
    if (!household) {
      setStatus("Could not find the household you just created. Try the Accounts tab.");
      return;
    }
    const fixture = fixtureBank();
    if (!fixture) {
      setStatus("Fixture bank client unavailable. Try the Accounts tab instead.");
      return;
    }

    setBusy(true);
    setStatus(null);
    try {
      const group = household.$jazz.owner;
      const connectionId = `${household.$jazz.id}:${me.$jazz.id}`;
      // In fixture mode, createRequisition returns LN immediately so we can
      // materialize the demo accounts + transactions inline, the same code
      // path Accounts.tsx uses for its "Link Revolut" demo button.
      const req = await platform.bankData.createRequisition(connectionId, {
        institutionId: "REVOLUT_REVOLT21",
        redirectUrl: "resonable://oauth/callback",
        reference: connectionId,
      });
      const accounts = await importAccountForConnection({
        bank: platform.bankData,
        connectionId,
        requisitionId: req.id,
        household,
        group,
        meAccountId: me.$jazz.id,
        institutionName: "Revolut",
        accountMeta: (id) => fixture.accountMeta(id),
      });
      setStatus(`Loaded ${accounts.length} demo account(s). Taking you to the dashboard...`);
      setTimeout(() => onDone("dashboard"), 700);
    } catch (err) {
      setStatus((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Bring in your first transactions</h2>
      <p className="muted">
        Pick one to see Resonable come alive. You can always do more from the
        Accounts and CSV import tabs later.
      </p>

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr", marginTop: 8 }}>
        <OptionCard
          title="Load fixture data"
          badge="demo"
          description={
            demo
              ? "Attach the built-in Revolut + N26 sample bank right here; no network calls."
              : "Only available in demo mode. Enable it in Settings to use sample data."
          }
          actionLabel={busy ? "Loading..." : "Load demo bank"}
          actionDisabled={!demo || busy}
          onAction={loadFixtureInline}
        />
        <OptionCard
          title="Link Revolut or N26"
          badge="real bank"
          description="Uses GoCardless. Requires the desktop build (Tauri) or a self-hosted broker so credentials never touch a third party."
          actionLabel="Go to Accounts"
          actionDisabled={busy}
          onAction={() => onDone("accounts")}
        />
        <OptionCard
          title="Import a CSV"
          badge="any bank"
          description="Bring a CSV export from any bank. You'll map columns to dates, amounts, and counterparties."
          actionLabel="Go to CSV import"
          actionDisabled={busy}
          onAction={() => onDone("import")}
        />
      </div>

      {status && <p className="muted" style={{ marginTop: 12 }}>{status}</p>}

      <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
        <button onClick={() => onDone("dashboard")} disabled={busy}>
          Skip for now
        </button>
      </div>
    </div>
  );
}

function OptionCard(props: {
  title: string;
  badge: string;
  description: string;
  actionLabel: string;
  actionDisabled?: boolean;
  onAction: () => void;
}) {
  const { title, badge, description, actionLabel, actionDisabled, onAction } = props;
  return (
    <div
      className="card"
      style={{ margin: 0, display: "flex", flexDirection: "column", gap: 8 }}
    >
      <div>
        <strong>{title}</strong>
        <span className="pill">{badge}</span>
      </div>
      <div className="muted">{description}</div>
      <div>
        <button
          className="primary"
          disabled={actionDisabled}
          onClick={onAction}
          style={{ fontSize: 13 }}
        >
          {actionLabel}
        </button>
      </div>
    </div>
  );
}
