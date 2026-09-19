import { Component, ErrorInfo, ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** 边界名称：上报与展示用（如「页面」「应用」「关键词卡」）。 */
  label?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
}

/**
 * 渲染错误兜底边界。
 *
 * - 捕获子树渲染错误，展示错误摘要与恢复动作，替代整窗白屏；
 * - componentDidCatch 时经 `app:reportError` IPC 写入 electron-log（主进程
 *   落文件日志），不再依赖不可靠的 console-message 转发；
 * - 「重试」重置内部错误态重新渲染子树；「复制诊断信息」把 message + stack
 *   + componentStack 复制进剪贴板，便于贴给开发者。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const componentStack = info.componentStack || null;
    this.setState({ componentStack });
    const label = this.props.label || "app";
    try {
      (window as any).appilot?.reportError?.(
        label,
        error.message,
        `${error.stack || ""}${componentStack ? `\n--- component stack ---${componentStack}` : ""}`,
      );
    } catch {
      // 上报失败不影响兜底 UI
    }
  }

  private reset = (): void => {
    this.setState({ error: null, componentStack: null });
  };

  private copyDiagnostics = (): void => {
    const { error, componentStack } = this.state;
    const text = [
      `label: ${this.props.label || "app"}`,
      `time: ${new Date().toISOString()}`,
      `route: ${window.location.hash}`,
      `message: ${error?.message ?? "(unknown)"}`,
      error?.stack ? `stack:\n${error.stack}` : "",
      componentStack ? `component stack:${componentStack}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    void navigator.clipboard?.writeText(text).catch(() => undefined);
  };

  render(): ReactNode {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        role="alert"
        className="m-4 rounded-2xl border border-red-200 dark:border-red-800/60 bg-red-50/70 dark:bg-red-950/20 p-5 text-sm text-red-800 dark:text-red-200"
      >
        <h2 className="text-base font-semibold">
          {this.props.label ? `${this.props.label} 出错了` : "界面出错了"}
        </h2>
        <p className="mt-1.5 text-xs opacity-80">
          渲染时发生未捕获异常。可以尝试重试；「复制诊断信息」后请反馈给开发者。
        </p>
        <p className="mt-2 font-mono text-[11px] break-all opacity-90">{error.message}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={this.reset}
            className="rounded-lg px-3 py-1.5 text-xs font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
          >
            重试
          </button>
          <button
            type="button"
            onClick={this.copyDiagnostics}
            className="rounded-lg px-3 py-1.5 text-xs font-medium border border-red-300 dark:border-red-800 hover:bg-red-100/60 dark:hover:bg-red-900/30 transition-colors"
          >
            复制诊断信息
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg px-3 py-1.5 text-xs font-medium border border-red-300 dark:border-red-800 hover:bg-red-100/60 dark:hover:bg-red-900/30 transition-colors"
          >
            重新加载应用
          </button>
        </div>
        {componentStack && (
          <details className="mt-3">
            <summary className="cursor-pointer text-[11px] opacity-70">组件栈</summary>
            <pre className="mt-1.5 whitespace-pre-wrap break-all font-mono text-[10px] leading-4 opacity-70">
              {componentStack}
            </pre>
          </details>
        )}
      </div>
    );
  }
}
