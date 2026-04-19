import { useState } from "react";
import { JazzApp } from "./jazz";
import { HouseholdView } from "./views/Household";
import { AccountsView } from "./views/Accounts";
import { TransactionsView } from "./views/Transactions";
import { ClustersView } from "./views/Clusters";
import { CategoriesView } from "./views/Categories";
import { RulesView } from "./views/Rules";
import { ModerationView } from "./views/Moderation";
import { SettingsView } from "./views/Settings";

type Tab = "household" | "accounts" | "transactions" | "clusters" | "categories" | "rules" | "moderation" | "settings";

export function App() {
  return (
    <JazzApp>
      <Shell />
    </JazzApp>
  );
}

function Shell() {
  const [tab, setTab] = useState<Tab>("household");
  return (
    <div className="app">
      <aside className="sidebar">
        <h1>Resonable</h1>
        <nav className="nav">
          <NavButton current={tab} id="household" onClick={setTab}>Household</NavButton>
          <NavButton current={tab} id="accounts" onClick={setTab}>Accounts</NavButton>
          <NavButton current={tab} id="transactions" onClick={setTab}>Transactions</NavButton>
          <NavButton current={tab} id="clusters" onClick={setTab}>Clusters</NavButton>
          <NavButton current={tab} id="categories" onClick={setTab}>Categories</NavButton>
          <NavButton current={tab} id="rules" onClick={setTab}>Rules</NavButton>
          <NavButton current={tab} id="moderation" onClick={setTab}>Moderation</NavButton>
          <NavButton current={tab} id="settings" onClick={setTab}>Settings</NavButton>
        </nav>
      </aside>
      <main>
        {tab === "household" && <HouseholdView />}
        {tab === "accounts" && <AccountsView />}
        {tab === "transactions" && <TransactionsView />}
        {tab === "clusters" && <ClustersView />}
        {tab === "categories" && <CategoriesView />}
        {tab === "rules" && <RulesView />}
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
