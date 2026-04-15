import { StrictMode, Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";

/** Error Boundary — catches render crashes and shows a recovery UI */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Elastic Drums crashed:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          height: "100vh", background: "#0a0a0a", color: "#e5e5e5", fontFamily: "system-ui, sans-serif",
          padding: "2rem", textAlign: "center",
        }}>
          <h1 style={{ fontSize: "1.5rem", color: "#f59e0b", marginBottom: "1rem" }}>Something went wrong</h1>
          <p style={{ fontSize: "0.875rem", color: "#888", maxWidth: "480px", marginBottom: "1.5rem" }}>
            {this.state.error.message}
          </p>
          <button
            onClick={() => { this.setState({ error: null }); window.location.reload(); }}
            style={{
              padding: "0.75rem 2rem", background: "#f59e0b", color: "#000", border: "none",
              borderRadius: "0.5rem", fontSize: "0.875rem", fontWeight: 700, cursor: "pointer",
            }}>
            Reload App
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

// Register Service Worker for PWA offline support
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then(
      (reg) => console.log("SW registered:", reg.scope),
      (err) => console.warn("SW registration failed:", err),
    );
  });
}
