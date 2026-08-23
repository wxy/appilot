import path from "path";

export function normalizeLocalPath(localPath: unknown): string {
  if (typeof localPath !== "string" || !localPath.trim()) return "";
  try {
    return path.resolve(localPath);
  } catch {
    return localPath.trim();
  }
}

export function assertNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

export function assertStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${name} must be an array of strings`);
  }
  return [...new Set(value as string[])];
}

/** Keep only the most recent project for each local path. */
export function dedupeProjects(projects: any[]): any[] {
  const byPath = new Map<string, any>();
  for (const project of projects) {
    const key = normalizeLocalPath(project?.localPath) || `id:${project?.id ?? Math.random()}`;
    byPath.set(key, project);
  }
  return [...byPath.values()];
}
