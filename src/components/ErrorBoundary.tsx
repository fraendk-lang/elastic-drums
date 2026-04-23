import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
    this.props.onError?.(error, info);
  }

  handleRetry = () => this.setState({ hasError: false, error: null });

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center p-4 gap-2 bg-[var(--ed-bg-surface)] border border-red-900/40 rounded text-center">
          <span className="text-[9px] font-bold tracking-widest text-red-400 uppercase">Audio Error</span>
          <span className="text-[8px] text-[var(--ed-text-muted)] max-w-[200px]">
            {this.state.error?.message ?? "Unknown error"}
          </span>
          <button
            onClick={this.handleRetry}
            className="mt-1 px-3 py-1 text-[8px] font-bold tracking-widest uppercase bg-[var(--ed-bg-elevated)] border border-white/10 rounded hover:border-white/20 text-[var(--ed-text-muted)]"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
