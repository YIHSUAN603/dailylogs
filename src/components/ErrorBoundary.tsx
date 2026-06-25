import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** 捕捉 render 期間的錯誤，避免整頁變白畫面 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary 捕捉到錯誤：", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-white p-8 text-center dark:bg-slate-900">
          <h1 className="text-lg font-bold text-rose-600 dark:text-rose-400">發生錯誤</h1>
          <p className="max-w-md text-sm text-slate-600 dark:text-slate-300">{this.state.error.message}</p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-md bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700"
          >
            重新載入
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
