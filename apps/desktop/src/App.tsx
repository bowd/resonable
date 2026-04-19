import { useState } from "react";
import type { ResonableAccount } from "@resonable/schema";
import { JazzApp, useCurrentAccount, useFirstHousehold } from "./jazz";
import { platform } from "./platform";
import { HouseholdView } from "./views/Household";
import { AccountsView } from "./views/Accounts";
import { TransactionsView } from "./views/Transactions";
import { ClustersView } from "./views/Clusters";
import { CategoriesView } from "./views/Categories";
import { DashboardView } from "./views/Dashboard";
import { TagsView } from "./views/Tags";
import { RulesView } from "./views/Rules";
import { ImportView } from "./views/Import";
import { ModerationView } from "./views/Moderation";
import { SettingsView } from "./views/Settings";
import { Onboarding, type OnboardingNavTarget } from "./views/Onboarding";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LoadingGate } from "./components/LoadingGate";

type Tab = "dashboard" | "household" | "accounts" | "transactions" | "clusters" | "categories" | "tags" | "rules" | "import" | "moderation" | "settings";

const TAB_LABELS: Record<Tab, string> = {
  dashboard: "Dashboard",
  household: "Household",
  accounts: "Accounts",
  transactions: "Transactions",
  clusters: "Clusters",
  categories: "Categories",
  tags: "Tags",
  rules: "Rules",
  import: "CSV import",
  moderation: "Moderation",
  settings: "Settings",
};

export function App() {
  return (
    <JazzApp>
      <Shell />
    </JazzApp>
  );
}

function Shell() {
  const me = useCurrentAccount();
  const { household } = useFirstHousehold();
  const [tab, setTab] = useState<Tab>("dashboard");

  // Gate the whole app on first-run: if the account has loaded and has no
  // household, show onboarding *instead* of the sidebar so nothing leaks
  // through (empty Dashboard, Accounts nags about no household, etc.).
  if (me.$isLoaded && !household) {
    return (
      <Onboarding
        me={me as ResonableAccount}
        onDone={(landing: OnboardingNavTarget) => {
          setTab(landing);
        }}
      />
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>
          Resonable
          <span
            className="pill"
            title={platform.isNative ? "Running in Tauri: secrets in OS keychain, native HTTP to GoCardless." : platform.mode === "broker" ? "Web + self-hosted broker for bank data." : "Fixture mode: Revolut/N26 sample data, no network."}
            style={{ marginLeft: 6, fontSize: 10, verticalAlign: "middle" }}
          >
            {platform.mode}
          </span>
        </h1>
        <nav className="nav">
          <NavButton current={tab} id="dashboard" onClick={setTab}>Dashboard</NavButton>
          <NavButton current={tab} id="household" onClick={setTab}>Household</NavButton>
          <NavButton current={tab} id="accounts" onClick={setTab}>Accounts</NavButton>
          <NavButton current={tab} id="transactions" onClick={setTab}>Transactions</NavButton>
          <NavButton current={tab} id="clusters" onClick={setTab}>Clusters</NavButton>
          <NavButton current={tab} id="categories" onClick={setTab}>Categories</NavButton>
          <NavButton current={tab} id="tags" onClick={setTab}>Tags</NavButton>
          <NavButton current={tab} id="rules" onClick={setTab}>Rules</NavButton>
          <NavButton current={tab} id="import" onClick={setTab}>CSV import</NavButton>
          <NavButton current={tab} id="moderation" onClick={setTab}>Moderation</NavButton>
          <NavButton current={tab} id="settings" onClick={setTab}>Settings</NavButton>
        </nav>
      </aside>
      <main>
        <ErrorBoundary name={TAB_LABELS[tab]} key={tab}>
          <LoadingGate>
            {tab === "dashboard" && <DashboardView />}
            {tab === "household" && <HouseholdView />}
            {tab === "accounts" && <AccountsView />}
            {tab === "transactions" && <TransactionsView />}
            {tab === "clusters" && <ClustersView />}
            {tab === "categories" && <CategoriesView />}
            {tab === "tags" && <TagsView />}
            {tab === "rules" && <RulesView />}
            {tab === "import" && <ImportView />}
            {tab === "moderation" && <ModerationView />}
            {tab === "settings" && <SettingsView />}
          </LoadingGate>
        </ErrorBoundary>
      </main>
    </div>
  );
}

function NavButton(props: {
  current: Tab;
  id: Tab;
  onClick: (t: Tab) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-current={props.current === props.id ? "page" : undefined}
      onClick={() => props.onClick(props.id)}
    >
      {props.children}
    </button>
  );
}
