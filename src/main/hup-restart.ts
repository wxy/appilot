export interface RelaunchableApp {
  relaunch(): void;
  exit(exitCode?: number): void;
}

export interface HupSignalTarget {
  on(event: "SIGHUP", listener: () => void): unknown;
  off(event: "SIGHUP", listener: () => void): unknown;
}

export interface RestartLogger {
  info(message: string): void;
  error(message: string): void;
}

/** 安装 SIGHUP → Electron 完整重启，并防止短时间重复信号拉起多个实例。 */
export function installHupRestart(
  app: RelaunchableApp,
  logger: RestartLogger,
  signalTarget: HupSignalTarget = process,
): () => void {
  let restarting = false;
  const handleHup = () => {
    if (restarting) return;
    restarting = true;
    logger.info("appilot: received SIGHUP, restarting Electron");
    try {
      app.relaunch();
      app.exit(0);
    } catch (error: any) {
      restarting = false;
      logger.error(`appilot: SIGHUP restart failed: ${error?.message || error}`);
    }
  };
  signalTarget.on("SIGHUP", handleHup);
  return () => signalTarget.off("SIGHUP", handleHup);
}
