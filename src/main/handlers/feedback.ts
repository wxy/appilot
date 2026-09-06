import { ipcMain } from "electron";
import { runOpsSyncNow } from "../scheduler";
import { createAiProvider } from "../ai-service";
import { buildProjectProfileFor } from "../release-service";
import { findProductContext } from "../project-state";
import { getStore } from "../store";
import { sharedStore } from "../registry-sync";
import { blobGet } from "../db-blob-read";
import { assertNonEmptyString } from "../util";

export function registerFeedbackHandlers(): void {
  ipcMain.handle("feedback:list", async (_event, projectId: string) => {
    projectId = assertNonEmptyString(projectId, "projectId");
    const s = await getStore();
    const dbF = blobGet(sharedStore(), "feedback", projectId) as { items?: unknown[] } | undefined;
    const kvF = (s.get("feedback") || {})[projectId];
    return (dbF?.items ?? kvF?.items) || [];
  });

  ipcMain.handle("feedback:themes", async (_event, projectId: string) => {
    projectId = assertNonEmptyString(projectId, "projectId");
    const s = await getStore();
    const dbF = blobGet(sharedStore(), "feedback", projectId) as { themes?: unknown[] } | undefined;
    const kvF = (s.get("feedback") || {})[projectId];
    return (dbF?.themes ?? kvF?.themes) || [];
  });

  ipcMain.handle("feedback:sync", async (_event, projectId: string) => {
    projectId = assertNonEmptyString(projectId, "projectId");
    return runOpsSyncNow(projectId);
  });

  ipcMain.handle("feedback:cluster", async (_event, projectId: string, productId: string) => {
    projectId = assertNonEmptyString(projectId, "projectId");
    productId = assertNonEmptyString(productId, "productId");
    const s = await getStore();
    const context = findProductContext(s.get("projects") || [], productId);
    if (!context) throw new Error("Store product not found");
    const { project, product } = context;
    const dbF = blobGet(sharedStore(), "feedback", projectId) as { items?: unknown[] } | undefined;
    const kvF = (s.get("feedback") || {})[projectId];
    const entry = dbF ?? kvF ?? { items: [] };
    const items = (entry.items || []).filter(
      (item: any) => item.source === "issue" || item.productId === productId,
    );
    if (items.length === 0) return [];

    const provider = await createAiProvider(s);
    const { generateReviewThemes } = await import("@appilot-labs/appilot-core/ai/review-insights");
    const description = (await import("@appilot-labs/appilot-core/app-store-discovery")).readRepoDescription(project.localPath);
    const profile = await buildProjectProfileFor(project, product, undefined, description);
    const themes = await generateReviewThemes(provider, profile, items, (received) => {
      if (!_event.sender.isDestroyed()) {
        _event.sender.send("feedback:clusterProgress", {
          chars: received.chars,
          phase: received.phase,
        });
      }
    });

    const feedbackStore: Record<string, any> = s.get("feedback") || {};
    feedbackStore[projectId] = {
      ...(feedbackStore[projectId] || { items: [] }),
      themes,
      lastClusteredAt: new Date().toISOString(),
    };
    s.set("feedback", feedbackStore);
    return themes;
  });
}
