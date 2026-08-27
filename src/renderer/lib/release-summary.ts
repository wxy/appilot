/**
 * Release change summary — rule-based grouping of commit/PR material into a
 * human-checkable coverage list. PRs come first (one row per PR, title from
 * the GitHub API when available) and commits that belong to no PR collapse
 * into a single count row — per the workbench design, no per-commit detail is
 * expanded in the summary.
 */

export type ChangeType = "feature" | "fix" | "perf" | "chore";

export interface ChangeSummaryItem {
  id: string;
  title: string;
  type: ChangeType;
  refs: string[];
  /** True when this item maps to a GitHub pull request (not a standalone commit). */
  github?: boolean;
  prNumber?: number;
  /** PR page URL when the PR info was fetched from GitHub. */
  prUrl?: string | null;
  /** Underlying commits (sha / date / body) for on-demand detail inspection. */
  commits: { sha: string; date: string; body: string }[];
  /** Display commit count: PR API count when known, else matched commits. */
  commitCount?: number;
  /** Primary date for ordering (PR mergedAt, else latest matched commit). */
  date?: string;
  /** True for the aggregated "commits without a PR" row. */
  standalone?: boolean;
}

const TYPE_ORDER: ChangeType[] = ["feature", "fix", "perf", "chore"];

function stableId(title: string, type: ChangeType): string {
  let hash = 5381;
  const input = `${title}\u0000${type}`;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return `sum-${hash.toString(36)}`;
}

function parseType(subject: string): { type: ChangeType; title: string } {
  const match = subject.match(/^(\w+)(?:\([^)]*\))?:\s*(.+)$/);
  if (!match) return { type: "chore", title: subject.trim() };
  const prefix = match[1].toLowerCase();
  const title = match[2].trim();
  const type: ChangeType =
    prefix === "feat" ? "feature"
    : prefix === "fix" ? "fix"
    : prefix === "perf" ? "perf"
    : "chore";
  return { type, title };
}

/** Strip trailing "(#N)" / " #N" from a commit subject for display. */
function stripPrRef(subject: string): string {
  return String(subject || "")
    .replace(/\s*\(?#\d+\)?\s*$/, "")
    .trim();
}

/**
 * Local material uses short shas (%h) while GitHub API / git rev-list return
 * full shas — compare by prefix so PR↔commit membership survives both forms.
 */
function shaMatches(local: string, full: string): boolean {
  const a = String(local || "").trim().toLowerCase();
  const b = String(full || "").trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length < 7) return false;
  return b.startsWith(a) || a.startsWith(b);
}

/**
 * Build the change coverage list:
 * - one row per PR (title from GitHub when fetched; commit count shown);
 * - remaining commits (no PR membership) aggregate into a single count row;
 * - sorted feature → fix → perf → chore, then by title.
 */
export function summarizeChanges(
  material: {
    commits: { sha: string; subject: string; body: string; date: string }[];
    pullRequests?: {
      number: number;
      title: string | null;
      url?: string | null;
      commits?: number;
      mergedAt?: string | null;
      commitShas?: string[];
    }[];
  } | null | undefined,
): ChangeSummaryItem[] {
  const commits = material?.commits || [];
  const pullRequests = material?.pullRequests || [];

  // PR ↔ commit membership: API/merge-commit shas plus "#N" in subjects.
  const shasByPr = new Map<number, Set<string>>();
  for (const pr of pullRequests) {
    shasByPr.set(pr.number, new Set(pr.commitShas || []));
  }
  for (const commit of commits) {
    for (const match of commit.subject.matchAll(/#(\d+)/g)) {
      const number = Number(match[1]);
      if (!shasByPr.has(number)) shasByPr.set(number, new Set());
      shasByPr.get(number)!.add(commit.sha);
    }
  }

  const matched = new Set<string>();
  const items: ChangeSummaryItem[] = [];
  const seen = new Set<number>();

  const pushPrItem = (number: number, fetched?: (typeof pullRequests)[number]) => {
    if (seen.has(number)) return;
    seen.add(number);
    const shas = Array.from(shasByPr.get(number) || []);
    const prCommits = commits.filter((commit) =>
      shas.some((full) => shaMatches(commit.sha, full)),
    );
    // A PR row represents this release's content. If none of its commits are
    // inside the range, its content was already generated (covered by the
    // previous boundary) — drop it instead of showing a phantom "0 提交" row.
    if (prCommits.length === 0) return;
    for (const commit of prCommits) matched.add(commit.sha);
    const first = prCommits[0];
    const parsed = first ? parseType(stripPrRef(first.subject)) : null;
    const title =
      fetched?.title ||
      (first ? parseType(stripPrRef(first.subject)).title : null) ||
      `PR #${number}`;
    const type =
      first && parsed?.type !== "chore"
        ? parsed!.type
        : fetched?.title
          ? parseType(fetched.title).type
          : parsed?.type || "chore";
    const latestDate =
      prCommits[0]?.date ||
      fetched?.mergedAt ||
      "";
    items.push({
      id: stableId(`#${number}:${title}`, type),
      title,
      type,
      refs: [`#${number}`],
      github: true,
      prNumber: number,
      prUrl: fetched?.url ?? null,
      commits: prCommits.map((commit) => ({
        sha: commit.sha,
        date: commit.date,
        body: commit.body,
      })),
      commitCount:
        typeof fetched?.commits === "number" ? fetched.commits : prCommits.length,
      date: fetched?.mergedAt || latestDate || undefined,
    });
  };

  // 1. PRs from the material list (API order when fetched).
  for (const pr of pullRequests) pushPrItem(pr.number, pr);

  // 2. PRs referenced only in commit subjects (no-token fallback / tests).
  for (const commit of commits) {
    if (matched.has(commit.sha)) continue;
    const numbers = Array.from(
      commit.subject.matchAll(/#(\d+)/g),
      (match) => Number(match[1]),
    );
    const number = numbers.find((num) => !seen.has(num));
    if (number !== undefined) pushPrItem(number);
  }

  // 3. Remaining commits → single aggregated count row.
  const standalone = commits.filter((commit) => !matched.has(commit.sha));
  if (standalone.length > 0) {
    const latest = standalone[standalone.length - 1]?.date || standalone[0]?.date || "";
    items.push({
      id: stableId("standalone-commits", "chore"),
      title: "未形成 PR 的提交",
      type: "chore",
      refs: [],
      commits: standalone.map((commit) => ({
        sha: commit.sha,
        date: commit.date,
        body: commit.body,
      })),
      commitCount: standalone.length,
      standalone: true,
      date: latest || undefined,
    });
  }

  items.sort((a, b) => {
    const typeDiff = TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type);
    return typeDiff !== 0 ? typeDiff : a.title.localeCompare(b.title);
  });
  return items.slice(0, 12);
}

export const CHANGE_TYPE_META: Record<ChangeType, { label: string; tone: "amber" | "emerald" | "sky" | "muted" }> = {
  feature: { label: "新功能", tone: "amber" },
  fix: { label: "修复", tone: "emerald" },
  perf: { label: "优化", tone: "sky" },
  chore: { label: "维护", tone: "muted" },
};
