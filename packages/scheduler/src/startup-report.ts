import { closeSync, fstatSync, writeSync } from 'node:fs';

/** Optional one-shot startup channel. Never inherited by self-restart children. */
export function reportStartup(result: { ok: boolean; pid: number; error?: string }): void {
  const enabled = process.env.APPILOT_STARTUP_REPORT_FD === '3';
  delete process.env.APPILOT_STARTUP_REPORT_FD;
  if (!enabled) return;
  // A stale environment flag must never close a descriptor owned by Node itself.
  try {
    const stat = fstatSync(3);
    if (!stat.isSocket() && !stat.isFIFO()) return;
  } catch { return; }
  try {
    writeSync(3, JSON.stringify({ ...result, error: result.error?.slice(0, 2000) }) + '\n');
    closeSync(3);
  } catch {
    // Parent may already have exited; diagnostics must not stop scheduling.
    // If the descriptor was invalid/read-only, do not close a Node-owned fd.
  }
}
