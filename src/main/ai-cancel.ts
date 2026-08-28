/**
 * 进行中的 AI 请求注册表：渲染层「停止」按钮通过 operationId 中止对应请求。
 * 主进程在每个 AI IPC 处理开始时注册 AbortController，结束（含失败）时注销。
 */
const activeRequests = new Map<string, AbortController>();

export function registerAiRequest(
  operationId: string,
  controller: AbortController,
): void {
  activeRequests.set(operationId, controller);
}

export function cancelAiRequest(operationId: string): boolean {
  const controller = activeRequests.get(operationId);
  if (!controller) return false;
  controller.abort();
  return true;
}

export function unregisterAiRequest(operationId: string): void {
  activeRequests.delete(operationId);
}

/** 把一个 AI 操作包成可取消单元；signal 传给底层请求。 */
export async function withAiOperation<T>(
  operationId: string,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  registerAiRequest(operationId, controller);
  try {
    return await fn(controller.signal);
  } finally {
    unregisterAiRequest(operationId);
  }
}
