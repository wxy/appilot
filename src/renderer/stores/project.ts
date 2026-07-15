import { create } from "zustand";

interface ProjectState {
  repoUrl: string;
  projectName: string;
  analysisResult: any | null;
  setRepoUrl: (url: string) => void;
  setProjectName: (name: string) => void;
  setAnalysisResult: (result: any) => void;
}

export const useProject = create<ProjectState>((set) => ({
  repoUrl: "",
  projectName: "",
  analysisResult: null,
  setRepoUrl: (repoUrl) => set({ repoUrl }),
  setProjectName: (projectName) => set({ projectName }),
  setAnalysisResult: (analysisResult) => set({ analysisResult }),
}));
