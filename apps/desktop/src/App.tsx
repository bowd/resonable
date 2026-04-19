import { useState } from "react";
import { JazzApp } from "./jazz";
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

type Tab = "dashboard" | "household" | "accounts" | "transactions" | "clusters" | "categories" | "tags" | "rules" | "import" | "moderation" | "settings";

export function App() {
  return (
    <JazzApp>
      <Shell />
    </JazzApp>
  );
}

function Shell() {
  const [tab, setTab] = useState<Tab>("dashboard");
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
