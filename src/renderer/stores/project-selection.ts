export const PROJECT_SELECTION_STORAGE_KEY = "appilot-project-selection-v1";

export interface ProjectSelection {
  projectId: string | null;
  productId: string | null;
}

interface SelectableProject {
  id: string;
  storeProducts: Array<{ id: string }>;
}

export function parseProjectSelection(raw: string | null): ProjectSelection | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    return {
      projectId: typeof value.projectId === "string" && value.projectId ? value.projectId : null,
      productId: typeof value.productId === "string" && value.productId ? value.productId : null,
    };
  } catch {
    return null;
  }
}

/** Restore only IDs that still belong to the freshly loaded project graph. */
export function resolveProjectSelection(
  projects: SelectableProject[],
  live: ProjectSelection,
  persisted: ProjectSelection | null,
): ProjectSelection {
  const project =
    projects.find((item) => item.id === live.projectId) ||
    projects.find((item) => item.id === persisted?.projectId) ||
    projects[0] ||
    null;
  if (!project) return { projectId: null, productId: null };

  const liveProductId = live.projectId === project.id ? live.productId : null;
  const persistedProductId = persisted?.projectId === project.id ? persisted.productId : null;
  const product =
    project.storeProducts.find((item) => item.id === liveProductId) ||
    project.storeProducts.find((item) => item.id === persistedProductId) ||
    project.storeProducts[0] ||
    null;
  return { projectId: project.id, productId: product?.id || null };
}
