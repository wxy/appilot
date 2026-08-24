import { getRemoteUrl, normalizeGitHubUrl } from "./git-info";
import { fetchGitHubJson } from "./gh-traffic";
import type { Review } from "./review-collector";

export type FeedbackSource = "review" | "issue";

export interface FeedbackItem {
  source: FeedbackSource;
  sourceId: string;
  /** Reviews carry the product id; issues are project-scoped (null). */
  productId: string | null;
  title: string;
  body: string;
  state: string | null;
  url: string;
  author: string;
  createdAt: string;
}

export interface FeedbackTheme {
  title: string;
  evidenceCount: number;
  sampleQuotes: string[];
  suggestedKeywords: string[];
  suggestedDescriptionAngles: string[];
  sourceBreakdown: { reviews: number; issues: number };
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  user: { login?: string } | null;
  created_at: string;
  pull_request?: unknown;
}

async function ownerRepoFrom(localPath: string): Promise<string | null> {
  const remote = await getRemoteUrl(localPath);
  const repoUrl = normalizeGitHubUrl(remote);
  if (!repoUrl) return null;
  return repoUrl.replace("https://github.com/", "");
}

export async function fetchIssues(
  localPath: string,
  token?: string | null,
  sinceDays = 30,
): Promise<GitHubIssue[]> {
  const ownerRepo = await ownerRepoFrom(localPath);
  if (!ownerRepo || !token) return [];
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
  const url = `https://api.github.com/repos/${ownerRepo}/issues?state=all&per_page=100&since=${encodeURIComponent(since)}&sort=created&direction=desc`;
  const res = await fetchGitHubJson(url, token, 8000);
  if (!res.ok || !Array.isArray(res.json)) return [];
  return res.json.filter((item: any) => !item.pull_request);
}

export function normalizeIssue(issue: GitHubIssue): FeedbackItem {
  return {
    source: "issue",
    sourceId: String(issue.number),
    productId: null,
    title: String(issue.title || ""),
    body: String(issue.body || ""),
    state: issue.state || null,
    url: String(issue.html_url || ""),
    author: String(issue.user?.login || ""),
    createdAt: String(issue.created_at || ""),
  };
}

export function reviewsToFeedbackItems(reviews: Review[], productId: string): FeedbackItem[] {
  return reviews.map((review) => ({
    source: "review" as const,
    sourceId: review.id,
    productId,
    title: review.title,
    body: review.body,
    state: null,
    url: "",
    author: review.author,
    createdAt: review.updatedAt,
  }));
}

export function mergeFeedbackItems(
  existing: FeedbackItem[],
  incoming: FeedbackItem[],
  limit = 500,
): FeedbackItem[] {
  const byKey = new Map<string, FeedbackItem>();
  for (const item of [...incoming, ...existing]) {
    const key = `${item.source}\u0000${item.sourceId}`;
    const current = byKey.get(key);
    if (!current || new Date(item.createdAt).getTime() > new Date(current.createdAt).getTime()) {
      byKey.set(key, item);
    }
  }
  return [...byKey.values()]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}
