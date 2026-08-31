import { getRemoteUrl, normalizeGitHubUrl } from "./git-info";

export interface TrafficSnapshot {
  date: string;
  views: number;
  uniqueViews: number;
  clones: number;
  uniqueClones: number;
  referrers: { url: string; views: number }[];
  /** Latest release tag whose assets were captured this day (null = none). */
  assetTag?: string | null;
  /** Per-asset download counts for the latest release, captured daily. */
  assetDownloads?: { name: string; downloadCount: number }[];
  source: "github-api";
}

export interface AssetDownloads {
  tag: string;
  assets: { name: string; downloadCount: number }[];
}

export async function fetchGitHubJson(
  url: string,
  token?: string | null,
  timeoutMs = 6000,
): Promise<{ ok: boolean; json: any }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        Accept: "application/vnd.github+json",
        "User-Agent": "appilot",
      },
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, json: null };
    return { ok: true, json: JSON.parse(await res.text()) };
  } catch {
    return { ok: false, json: null };
  } finally {
    clearTimeout(timer);
  }
}

async function ownerRepoFrom(localPath: string): Promise<string | null> {
  const remote = await getRemoteUrl(localPath);
  const repoUrl = normalizeGitHubUrl(remote);
  if (!repoUrl) return null;
  return repoUrl.replace("https://github.com/", "");
}

export async function fetchTrafficSnapshot(
  localPath: string,
  token?: string | null,
): Promise<TrafficSnapshot | null> {
  const ownerRepo = await ownerRepoFrom(localPath);
  if (!ownerRepo || !token) return null;
  const base = `https://api.github.com/repos/${ownerRepo}/traffic`;
  const [views, clones, referrers] = await Promise.all([
    fetchGitHubJson(`${base}/views`, token),
    fetchGitHubJson(`${base}/clones`, token),
    fetchGitHubJson(`${base}/popular/referrers`, token),
  ]);
  if (!views.ok || !clones.ok) return null;
  return {
    date: new Date().toISOString().slice(0, 10),
    views: views.json.count ?? 0,
    uniqueViews: views.json.uniques ?? 0,
    clones: clones.json.count ?? 0,
    uniqueClones: clones.json.uniques ?? 0,
    referrers: (Array.isArray(referrers.json) ? referrers.json : [])
      .map((r: any) => ({ url: r.referrer || "", views: r.count ?? 0 })),
    source: "github-api",
  };
}

export async function fetchReleaseAssetDownloads(
  localPath: string,
  tag: string,
  token?: string | null,
): Promise<AssetDownloads | null> {
  const ownerRepo = await ownerRepoFrom(localPath);
  if (!ownerRepo) return null;
  const res = await fetchGitHubJson(
    `https://api.github.com/repos/${ownerRepo}/releases/tags/${encodeURIComponent(tag)}`,
    token,
  );
  if (!res.ok) return null;
  return {
    tag,
    assets: (Array.isArray(res.json.assets) ? res.json.assets : []).map((a: any) => ({
      name: a.name || "",
      downloadCount: a.download_count ?? 0,
    })),
  };
}
