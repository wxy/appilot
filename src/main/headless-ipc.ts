/**
 * Headless 只读 IPC 通道（最终要求：Electron 壳查看共享 DB 的活动任务）。
 *
 * renderer 现有 TaskCenterPage 经 preload scheduler.* 读 electron-store 的
 * scheduledTasks（本壳任务）。为达成「任何壳看到同一份任务」，这里暴露共享
 * DB（headless store）的只读查询——renderer 组件逐步切换数据源，最终与
 * DSH / CLI / MCP 看到同一份实例（含 daemon 执行的状态）。
 * 只读：查看不经过这里；控制仍走 scheduler:runTaskNow / setAccel（已按主分流）。
 */
import { ipcMain } from "electron";
import { sharedStore } from "./registry-sync";
import { createHeadlessService } from "@appilot-labs/appilot-headless";

export function registerHeadlessReadIpc(): void {
  const svc = () => createHeadlessService(sharedStore());

  ipcMain.handle("appilot:db:tasks", async (_e, opts?: { source?: string }) => {
    const s = svc();
    const tasks = opts?.source ? s.tasks.listBySource(opts.source) : s.tasks.list();
    return { tasks };
  });

  ipcMain.handle("appilot:db:rankProgress", async (_e, opts?: { projectName?: string; productId?: string }) => {
    return { groups: svc().tasks.rankProgress({ projectName: opts?.projectName, productId: opts?.productId }) };
  });

  ipcMain.handle("appilot:db:lease", async () => {
    const info = sharedStore().lease.info();
    return { leader: info?.leaderId ?? null, heartbeatAt: info?.heartbeatAt ?? null };
  });

  ipcMain.handle("appilot:db:projects", async () => {
    return { projects: svc().projects.list() };
  });
}
