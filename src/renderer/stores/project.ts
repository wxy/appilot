import { create } from "zustand";

export interface Project {
  id: string;
  name: string;
  localPath: string;
  productType: "ios" | "macos" | null;
  bundleId: string | null;
  trackId: string | null;
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
}

export const useProject = create<ProjectState>((set, get) => ({
  projects: [],
  currentProjectId: null,
  loading: false,

  load: async () => {
    set({ loading: true });
    try {
      const projects = await (window as any).appilot.projects.list();
      set({
        projects: projects || [],
        currentProjectId: get().currentProjectId || projects?.[0]?.id || null,
      });
    } finally {
      set({ loading: false });
    }
  },

  addByFolder: async (localPath) => {
    const project = await (window as any).appilot.projects.add(localPath);
    set((s) => ({ projects: [...s.projects, project], currentProjectId: project.id }));
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
}));
