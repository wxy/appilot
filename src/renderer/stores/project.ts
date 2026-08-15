import { create } from "zustand";

export interface KeywordEntry {
  language: string;
  keyword: string;
  rationale: string;
}

export interface SubmissionKeywordsEntry {
  language: string;
  text: string;
}

export interface RemovedKeywordEntry {
  language: string;
  keyword: string;
}

export interface RankSnapshot {
  keyword: string;
  language: string;
  storefront: string;
  rank: number | null;
  totalResults: number;
  checkedAt: string;
}

export interface Project {
  id: string;
  name: string;
  localPath: string;
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
  createdAt: string;
}

interface ProjectState {
  projects: Project[];
  currentProjectId: string | null;
  loading: boolean;
  load: () => Promise<void>;
  addByFolder: (localPath: string) => Promise<Project>;
  select: (id: string) => void;
  remove: (id: string) => Promise<void>;
  updateTrackedKeywords: (id: string, keywords: KeywordEntry[]) => void;
  updateSubmissionKeywords: (id: string, submission: SubmissionKeywordsEntry[]) => void;
  removeTrackedKeyword: (id: string, language: string, keyword: string) => Promise<void>;
  collectRanks: (id: string, language: string, storefront: string) => Promise<RankSnapshot[]>;
}

/** Normalize persisted projects, tolerating legacy shapes. */
function normalizeProject(p: any): Project {
  return {
    ...p,
    supportedLanguages: p.supportedLanguages || [],
    storeLinks: p.storeLinks || [],
    trackedKeywords: (p.trackedKeywords || p.keywords || []).map((k: any) => ({
      language: k.language || "unknown",
      keyword: k.keyword,
      rationale: k.rationale || "",
    })),
    submissionKeywords: p.submissionKeywords || [],
    removedKeywords: p.removedKeywords || [],
    rankSnapshots: p.rankSnapshots || [],
  };
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
  loading: false,

  load: async () => {
    set({ loading: true });
    try {
      const raw = (await (window as any).appilot.projects.list()) || [];
      const projects = raw.map(normalizeProject);
      set({
        projects,
        currentProjectId: get().currentProjectId || projects?.[0]?.id || null,
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
      };
    });
    return project;
  },

  select: (id) => set({ currentProjectId: id }),

  remove: async (id) => {
    await (window as any).appilot.projects.remove(id);
    set((s) => {
      const projects = s.projects.filter((p) => p.id !== id);
      return {
        projects,
        currentProjectId: s.currentProjectId === id ? projects[0]?.id ?? null : s.currentProjectId,
      };
    });
  },

  updateTrackedKeywords: (id, keywords) => {
    set((s) => ({
      projects: s.projects.map((p) => (p.id === id ? { ...p, trackedKeywords: keywords } : p)),
    }));
  },

  updateSubmissionKeywords: (id, submission) => {
    set((s) => ({
      projects: s.projects.map((p) => (p.id === id ? { ...p, submissionKeywords: submission } : p)),
    }));
  },

  removeTrackedKeyword: async (id, language, keyword) => {
    const project = normalizeProject(
      await (window as any).appilot.projects.removeTrackedKeyword(id, language, keyword),
    );
    set((s) => ({
      projects: s.projects.map((p) => (p.id === id ? project : p)),
    }));
  },

  collectRanks: async (id, language, storefront) => {
    const off = (window as any).appilot?.projects?.onRankProgress?.((progress: any) => {
      if (!progress?.snapshot) return;
      set((s) => ({
        projects: s.projects.map((p) =>
          p.id === id
            ? {
                ...p,
                rankSnapshots: upsertRankSnapshot(p.rankSnapshots || [], progress.snapshot),
              }
            : p,
        ),
      }));
    });

    try {
      const project = normalizeProject(
        await (window as any).appilot.projects.collectRanks(id, language, storefront),
      );
      set((s) => ({
        projects: s.projects.map((p) => (p.id === id ? project : p)),
      }));
      return project.rankSnapshots;
    } finally {
      off?.();
    }
  },
}));
