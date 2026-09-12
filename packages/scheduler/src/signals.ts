import type { DaemonHandle } from "./daemon.js";

export interface SchedulerSignalTarget {
  on(event: "SIGHUP", listener: () => void): unknown;
  off(event: "SIGHUP", listener: () => void): unknown;
}

/** 把 SIGHUP 接到 daemon 的安全重启流程，并抑制连续信号造成的重复拉起。 */
export function installSchedulerHupRestart(
  handle: Pick<DaemonHandle, "requestRestart">,
  log: (message: string) => void = (message) => console.log(`[appilot-scheduler] ${message}`),
  signalTarget: SchedulerSignalTarget = process,
): () => void {
  let requested = false;

  const onHup = () => {
    if (requested) return;
    requested = true;
    log("received SIGHUP; scheduling daemon restart");
    try {
      // requestRestart 内部保证先关闭 socket、释放租约，再 spawn 继任者。
      handle.requestRestart("SIGHUP");
    } catch (error: any) {
      requested = false;
      log(`SIGHUP restart request failed: ${error?.message || String(error)}`);
    }
  };

  signalTarget.on("SIGHUP", onHup);
  return () => signalTarget.off("SIGHUP", onHup);
}
