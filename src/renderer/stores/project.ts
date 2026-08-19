import { create } from "zustand";

export interface KeywordEntry {
  language: string;
  keyword: string;
  rationale: string;
  translation: string;
  status?: "active" | "paused";
  source?: "ai" | "submission" | "name" | "subtitle" | "manual";
  addedAt?: string;
  bestRank?: number | null;
  lastSeenAt?: string | null;
  pausedAt?: string | null;
  pausedReason?: string | null;
}

export interface SubmissionKeywordsEntry {
  language: string;
  text: string;
}

export interface RemovedKeywordEntry {
  language: string;
  keyword: string;
  rationale: string;
  translation: string;
  removedAt: string;
}

export interface RankSnapshot {
  keyword: string;
  language: string;
  storefront: string;
  rank: number | null;
  totalResults: number;
  checkedAt: string;
}

export interface RepoInfo {
  remoteUrl: string | null;
  githubUrl: string | null;
  branch: string | null;
  headSha: string | null;
  headMessage: string | null;
  headDate: string | null;
  dirty: boolean;
  description: string | null;
  capturedAt: string;
}

export interface StoreProduct {
  id: string;
  projectId: string;
  platform: "ios" | "macos" | "unknown";
  trackId: string | null;
  bundleId: string | null;
  trackName: string | null;
  artworkUrl: string | null;
  supportedLanguages: { code: string; name: string }[];
  storeLinks: { country: string; name: string; platform: "ios" | "macos" | "unknown"; url: string }[];
  trackedKeywords: KeywordEntry[];
  submissionKeywords: SubmissionKeywordsEntry[];
  removedKeywords: RemovedKeywordEntry[];
  rankSnapshots: RankSnapshot[];
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  localPath: string;
  createdAt: string;
  repo: RepoInfo | null;
  storeProducts: StoreProduct[];

  // Legacy summary fields, kept for compatibility and migration.
  productType: "ios" | "macos" | null;
  bundleId: string | null;
  trackId: string | null;
  trackName: string | null;
  artworkUrl: string | null;
  supportedLanguages: { code: string; name: string }[];
  storeLinks: { country: string; name: string; platform: "ios" | "macos" | "unknown"; url: string }[];
  trackedKeywords: KeywordEntry[];
  submissionKeywords: SubmissionKeywordsEntry[];
  removedKeywords: RemovedKeywordEntry[];
  rankSnapshots: RankSnapshot[];
}

interface ProjectState {
  projects: Project[];
  currentProjectId: string | null;
  currentProductId: string | null;
  loading: boolean;
  load: () => Promise<void>;
  addByFolder: (localPath: string) => Promise<Project>;
  select: (id: string) => void;
  selectProduct: (id: string) => void;
  remove: (id: string) => Promise<void>;
  updateTrackedKeywords: (productId: string, keywords: KeywordEntry[]) => void;
  updateSubmissionKeywords: (productId: string, submission: SubmissionKeywordsEntry[]) => void;
  removeTrackedKeyword: (productId: string, language: string, keyword: string) => Promise<void>;
  restoreTrackedKeyword: (productId: string, language: string, keyword: string) => Promise<void>;
  resumePausedKeyword: (productId: string, language: string, keyword: string) => Promise<void>;
  clearRemovedKeywords: (productId: string, languages: string[]) => Promise<void>;
  collectRanks: (productId: string, language: string, storefront: string) => Promise<RankSnapshot[]>;
}

function normalizeKeyword(item: any): KeywordEntry {
  return {
    ...item,
    language: item.language || "unknown",
    keyword: item.keyword,
    rationale: item.rationale || "",
    translation: item.translation || "",
    status: item.status === "paused" ? "paused" : "active",
    source: item.source || "manual",
    addedAt: item.addedAt || "",
    bestRank: typeof item.bestRank === "number" ? item.bestRank : null,
    lastSeenAt: item.lastSeenAt || null,
    pausedAt: item.pausedAt || null,
    pausedReason: item.pausedReason || null,
  };
}

function normalizeRemovedKeyword(item: any): RemovedKeywordEntry {
  return {
    language: item.language || "unknown",
    keyword: item.keyword,
    rationale: item.rationale || "",
    translation: item.translation || "",
    removedAt: item.removedAt || new Date().toISOString(),
  };
}

function normalizeRepo(repo: any): RepoInfo | null {
  if (!repo || typeof repo !== "object") return null;
  return {
    remoteUrl: typeof repo.remoteUrl === "string" ? repo.remoteUrl : null,
    githubUrl: typeof repo.githubUrl === "string" ? repo.githubUrl : null,
    branch: typeof repo.branch === "string" ? repo.branch : null,
    headSha: typeof repo.headSha === "string" ? repo.headSha : null,
    headMessage: typeof repo.headMessage === "string" ? repo.headMessage : null,
    headDate: typeof repo.headDate === "string" ? repo.headDate : null,
    dirty: Boolean(repo.dirty),
    description: typeof repo.description === "string" ? repo.description : null,
    capturedAt:
      typeof repo.capturedAt === "string" ? repo.capturedAt : new Date().toISOString(),
  };
}

function normalizeStoreProduct(product: any, projectId: string): StoreProduct {
  return {
    id: product.id || `${projectId}:${product.platform || "unknown"}`,
    projectId,
    platform: product.platform || "unknown",
    trackId: product.trackId ?? null,
    bundleId: product.bundleId ?? null,
    trackName: product.trackName ?? null,
    artworkUrl: product.artworkUrl ?? null,
    supportedLanguages: product.supportedLanguages || [],
    storeLinks: product.storeLinks || [],
    trackedKeywords: (product.trackedKeywords || []).map(normalizeKeyword),
    submissionKeywords: product.submissionKeywords || [],
    removedKeywords: (product.removedKeywords || []).map(normalizeRemovedKeyword),
    rankSnapshots: product.rankSnapshots || [],
    createdAt: product.createdAt || new Date().toISOString(),
  };
}

function migrateLegacyProject(p: any): StoreProduct[] {
  const existingProducts = Array.isArray(p.storeProducts) ? p.storeProducts : [];
  const legacyKeywords = p.trackedKeywords || p.keywords || [];
  const duplicatedLegacyData =
    existingProducts.length > 1 &&
    legacyKeywords.length > 0 &&
    existingProducts.every((product: any) => {
      const productKeywords = product.trackedKeywords || [];
      if (productKeywords.length !== legacyKeywords.length) return false;
      return productKeywords.every((item: any, index: number) =>
        item.language === legacyKeywords[index]?.language &&
        item.keyword === legacyKeywords[index]?.keyword,
      );
    });

  if (existingProducts.length > 0 && !duplicatedLegacyData) {
    return existingProducts.map((product: any) => normalizeStoreProduct(product, p.id));
  }

  const platforms = new Set<string>();
  const links = p.storeLinks || [];
  for (const link of links) {
    platforms.add(link.platform || "unknown");
  }
  if (platforms.size === 0) {
    platforms.add(p.productType || "unknown");
  }

  const platformList = [...platforms];
  const primaryPlatform = p.productType || platformList[0];

  return platformList.map((platform) =>
    normalizeStoreProduct(
      {
        platform,
        trackId: p.trackId ?? null,
        bundleId: p.bundleId ?? null,
        trackName: p.trackName ?? null,
        artworkUrl: p.artworkUrl ?? null,
        supportedLanguages: p.supportedLanguages || [],
        storeLinks: links.filter((link: any) => (link.platform || "unknown") === platform),
        trackedKeywords: platform === primaryPlatform ? p.trackedKeywords || p.keywords || [] : [],
        submissionKeywords: platform === primaryPlatform ? p.submissionKeywords || [] : [],
        removedKeywords: platform === primaryPlatform ? p.removedKeywords || [] : [],
        rankSnapshots: platform === primaryPlatform ? p.rankSnapshots || [] : [],
        createdAt: p.createdAt || new Date().toISOString(),
      },
      p.id,
    ),
  );
}

function summarizeLegacyProject(products: StoreProduct[]): Partial<Project> {
  const primary = products[0];
  if (!primary) {
    return {
      productType: null,
      bundleId: null,
      trackId: null,
      trackName: null,
      artworkUrl: null,
      supportedLanguages: [],
      storeLinks: [],
      trackedKeywords: [],
      submissionKeywords: [],
      removedKeywords: [],
      rankSnapshots: [],
    };
  }
  return {
    productType: primary.platform === "unknown" ? null : primary.platform,
    bundleId: primary.bundleId,
    trackId: primary.trackId,
    trackName: primary.trackName,
    artworkUrl: primary.artworkUrl,
    supportedLanguages: primary.supportedLanguages,
    storeLinks: primary.storeLinks,
    trackedKeywords: primary.trackedKeywords,
    submissionKeywords: primary.submissionKeywords,
    removedKeywords: primary.removedKeywords,
    rankSnapshots: primary.rankSnapshots,
  };
}

function normalizeProject(p: any): Project {
  const products = migrateLegacyProject(p);
  return {
    ...p,
    repo: normalizeRepo(p.repo),
    storeProducts: products,
    ...summarizeLegacyProject(products),
  };
}

function updateProduct(
  projects: Project[],
  productId: string,
  updater: (product: StoreProduct) => StoreProduct,
): Project[] {
  return projects.map((project) => {
    if (!project.storeProducts.some((product) => product.id === productId)) return project;
    const storeProducts = project.storeProducts.map((product) =>
      product.id === productId ? updater(product) : product,
    );
    return {
      ...project,
      storeProducts,
      ...summarizeLegacyProject(storeProducts),
    };
  });
}

function upsertRankSnapshot(snapshots: RankSnapshot[], snapshot: RankSnapshot): RankSnapshot[] {
  const index = snapshots.findIndex(
    (existing) =>
      existing.keyword === snapshot.keyword &&
      existing.language === snapshot.language &&
      existing.storefront === snapshot.storefront &&
      existing.checkedAt === snapshot.checkedAt,
  );
  if (index >= 0) {
    const next = [...snapshots];
    next[index] = snapshot;
    return next;
  }
  return [...snapshots, snapshot];
}

export const useProject = create<ProjectState>((set, get) => ({
  projects: [],
  currentProjectId: null,
  currentProductId: null,
  loading: false,

  load: async () => {
    set({ loading: true });
    try {
      const raw = (await (window as any).appilot.projects.list()) || [];
      const projects: Project[] = raw.map(normalizeProject);
      const currentProjectId = get().currentProjectId || projects?.[0]?.id || null;
      const currentProject = projects.find((project) => project.id === currentProjectId);
      set({
        projects,
        currentProjectId,
        currentProductId: get().currentProductId || currentProject?.storeProducts?.[0]?.id || null,
      });
    } finally {
      set({ loading: false });
    }
  },

  addByFolder: async (localPath) => {
    const project = normalizeProject(await (window as any).appilot.projects.add(localPath));
    set((s) => {
      const exists = s.projects.some((p) => p.id === project.id);
      return {
        projects: exists
          ? s.projects.map((p) => (p.id === project.id ? project : p))
          : [...s.projects, project],
        currentProjectId: project.id,
        currentProductId: project.storeProducts[0]?.id || null,
      };
    });
    return project;
  },

  select: (id) => {
    const project = get().projects.find((item) => item.id === id);
    set({
      currentProjectId: id,
      currentProductId: project?.storeProducts?.[0]?.id || null,
    });
  },

  selectProduct: (id) => set({ currentProductId: id }),

  remove: async (id) => {
    await (window as any).appilot.projects.remove(id);
    set((s) => {
      const projects = s.projects.filter((p) => p.id !== id);
      const currentProjectId = s.currentProjectId === id ? projects[0]?.id ?? null : s.currentProjectId;
      const currentProject = projects.find((project) => project.id === currentProjectId);
      return {
        projects,
        currentProjectId,
        currentProductId: currentProject?.storeProducts?.[0]?.id || null,
      };
    });
  },

  updateTrackedKeywords: (productId, keywords) => {
    set((s) => ({
      projects: updateProduct(s.projects, productId, (product) => ({ ...product, trackedKeywords: keywords })),
    }));
  },

  updateSubmissionKeywords: (productId, submission) => {
    set((s) => ({
      projects: updateProduct(s.projects, productId, (product) => ({ ...product, submissionKeywords: submission })),
    }));
  },

  removeTrackedKeyword: async (productId, language, keyword) => {
    const updatedProject = normalizeProject(
      await (window as any).appilot.projects.removeTrackedKeyword(productId, language, keyword),
    ) as unknown as Project;
    set((s) => ({
      projects: s.projects.map((project) => (project.id === updatedProject.id ? updatedProject : project)),
    }));
  },

  restoreTrackedKeyword: async (productId, language, keyword) => {
    const updatedProject = normalizeProject(
      await (window as any).appilot.projects.restoreTrackedKeyword(productId, language, keyword),
    ) as unknown as Project;
    set((s) => ({
      projects: s.projects.map((project) => (project.id === updatedProject.id ? updatedProject : project)),
    }));
  },

  resumePausedKeyword: async (productId, language, keyword) => {
    const updatedProject = normalizeProject(
      await (window as any).appilot.projects.resumePausedKeyword(productId, language, keyword),
    ) as unknown as Project;
    set((s) => ({
      projects: s.projects.map((project) => (project.id === updatedProject.id ? updatedProject : project)),
    }));
  },

  clearRemovedKeywords: async (productId, languages) => {
    const updatedProject = normalizeProject(
      await (window as any).appilot.projects.clearRemovedKeywords(productId, languages),
    ) as unknown as Project;
    set((s) => ({
      projects: s.projects.map((project) => (project.id === updatedProject.id ? updatedProject : project)),
    }));
  },

  collectRanks: async (productId, language, storefront) => {
    const off = (window as any).appilot?.projects?.onRankProgress?.((progress: any) => {
      if (!progress?.snapshot) return;
      set((s) => ({
        projects: updateProduct(s.projects, productId, (product) => ({
          ...product,
          rankSnapshots: upsertRankSnapshot(product.rankSnapshots || [], progress.snapshot),
        })),
      }));
    });

    try {
      const updatedProject = normalizeProject(
        await (window as any).appilot.projects.collectRanks(productId, language, storefront),
      ) as unknown as Project;
      set((s) => ({
        projects: s.projects.map((project) => (project.id === updatedProject.id ? updatedProject : project)),
      }));
      return updatedProject.storeProducts.find((product) => product.id === productId)?.rankSnapshots || [];
    } finally {
      off?.();
    }
  },
}));
