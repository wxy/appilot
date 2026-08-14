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
  };
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
}));
