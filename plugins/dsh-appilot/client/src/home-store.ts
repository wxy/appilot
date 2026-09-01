/**
 * 应用首页浮层的共享状态（侧边栏入口 ↔ shell.overlay 浮层之间的开关）。
 * 极简订阅总线，无外部依赖。
 */
type Listener = (open: boolean) => void;

let open = false;
const listeners = new Set<Listener>();

export function isHomeOpen(): boolean {
  return open;
}

export function openHome(): void {
  open = true;
  for (const fn of listeners) fn(open);
}

export function closeHome(): void {
  open = false;
  for (const fn of listeners) fn(open);
}

export function toggleHome(): void {
  if (open) closeHome();
  else openHome();
}

/** React 订阅：返回当前状态，并在变化时触发重渲染。 */
export function subscribeHome(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
