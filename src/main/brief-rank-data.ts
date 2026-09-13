import type { RankSnapshotLike } from "@appilot-labs/appilot-core/overview-summary";
import type { AppilotStore } from "@appilot-labs/appilot-headless";

export interface BriefRankData {
  snapshots: RankSnapshotLike[];
  source: "sqlite" | "project-fallback" | "none";
}

/** Resolve AI ranking evidence from SQLite before the project fallback. */
export function resolveBriefRankData(
  store: AppilotStore,
  projectName: string,
  productId: string,
  fallback: RankSnapshotLike[] = [],
  onError?: (error: unknown) => void,
): BriefRankData {
  try {
    const rows = store.snapshots.history(projectName, { productId });
    if (rows.length > 0) return { snapshots: rows, source: "sqlite" };
  } catch (error) {
    onError?.(error);
  }
  if (fallback.length > 0) return { snapshots: fallback, source: "project-fallback" };
  return { snapshots: [], source: "none" };
}
