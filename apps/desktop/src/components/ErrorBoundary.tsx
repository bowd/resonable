import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { name: string; children: ReactNode };
type State = { error: Error | null; info: ErrorInfo | null };

/**
 * View-scoped error boundary. Contains render errors to a single view so the
 * rest of the shell (sidebar, nav, other tabs) stays usable. Resetting is
 * done either by the user pressing "Try again" or externally by changing the
 * `key` prop (App.tsx keys these by tab name).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(error, info);
    this.setState({ error, info });
  }

  private reset = (): void => {
    this.setState({ error: null, info: null });
  };

  private copy = (): void => {
    const { error } = this.state;
    if (!error) return;
    const message = error.message ?? String(error);
    const stack = error.stack ?? "";
    void navigator.clipboard?.writeText(`${message}\n${stack}`);
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    const rawMessage = error.message ?? String(error);
    const message = rawMessage.length > 200 ? `${rawMessage.slice(0, 200)}…` : rawMessage;

    return (
      <div
        role="alert"
        style={{
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: 16,
          margin: 16,
          maxWidth: 640,
          background: "var(--bg)",
          color: "var(--fg)",
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 8 }}>
          Something went wrong in the {this.props.name} view.
        </div>
        <pre
          style={{
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontSize: 12,
            color: "var(--muted)",
            margin: "0 0 12px",
          }}
        >
          {message}
        </pre>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={this.reset}>Try again</button>
          <button type="button" onClick={this.copy}>Copy error</button>
        </div>
      </div>
    );
  }
}
