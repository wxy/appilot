import { ErrorBoundary } from "./components/ui/ErrorBoundary";

// 全局兜底：ErrorBoundary 管渲染错误；这里补异步/事件回调中的错误与未处理 rejection，
// 统一经 app:reportError 写入主进程 electron-log（生产白屏不再是「无痕迹」）。
function installGlobalErrorReporting(): void {
  const report = (kind: string) => (message: string, stack?: string) => {
    try {
      (window as any).appilot?.reportError?.(kind, message, stack);
    } catch {
      /* 上报失败静默 */
    }
  };
  window.addEventListener("error", (event) => {
    report("window.error")(event.message, event.error?.stack);
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = (event as PromiseRejectionEvent).reason;
    report("unhandledrejection")(String(reason), reason?.stack);
  });
}

installGlobalErrorReporting();

import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { App } from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary label="应用">
      <HashRouter>
        <App />
      </HashRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
