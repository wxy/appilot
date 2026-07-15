import { create } from "zustand";

type Theme = "light" | "dark" | "system";

interface ThemeState {
  theme: Theme;
  resolved: "light" | "dark";
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

function getSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(resolved: "light" | "dark") {
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

export const useTheme = create<ThemeState>((set, get) => {
  const initial = (localStorage.getItem("appilot-theme") as Theme) || "system";
  const resolved = initial === "system" ? getSystemTheme() : initial;
  applyTheme(resolved);

  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      if (get().theme === "system") {
        const sys = getSystemTheme();
        applyTheme(sys);
        set({ resolved: sys });
      }
    });

  return {
    theme: initial,
    resolved,
    setTheme: (theme: Theme) => {
      const resolved = theme === "system" ? getSystemTheme() : theme;
      applyTheme(resolved);
      localStorage.setItem("appilot-theme", theme);
      set({ theme, resolved });
    },
    toggle: () => {
      const r = get().resolved;
      const next = r === "dark" ? "light" : "dark";
      applyTheme(next);
      localStorage.setItem("appilot-theme", next);
      set({ theme: next, resolved: next });
    },
  };
});
