/**
 * Release change summary — rule-based grouping of commit/PR material into a
 * human-checkable coverage list (AI summary is a later upgrade; the item
 * shape stays the same).
 */

export type ChangeType = "feature" | "fix" | "perf" | "chore";

function isMergeCommit(subject: string): boolean {
  return /^Merge\s+(pull\s+request|branch)/i.test(String(subject || "").trim());
}

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

/** Group commits into a coverage list: PRs aggregate their commits; sort feature→chore. */
export function summarizeChanges(
  material: {
    commits: { sha: string; subject: string; body: string; date: string }[];
    pullRequests?: { number: number; title: string | null; url?: string | null }[];
  } | null | undefined,
): ChangeSummaryItem[] {
  const commits = material?.commits || [];
  const pullRequests = material?.pullRequests || [];
  const prGroups = new Map<
    number,
    {
      title: string;
      type: ChangeType;
      refs: string[];
      prUrl?: string | null;
      commits: ChangeSummaryItem["commits"];
    }
  >();
  const standalone: { sha: string; subject: string; date: string; body: string }[] = [];

  for (const commit of commits) {
    // Merge commits carry no content of their own; their changes appear as
    // the branch commits inside the same range.
    if (isMergeCommit(commit.subject)) continue;
    const prMatch = commit.subject.match(/#(\d+)/);
    if (prMatch) {
      const number = Number(prMatch[1]);
      const cleaned = commit.subject.replace(/\s*\(?#\d+\)?\s*$/, "").trim();
      const parsed = parseType(cleaned);
      const fetched = pullRequests.find((pr) => pr.number === number);
      const existing = prGroups.get(number);
      if (existing) {
        if (existing.type === "chore" && parsed.type !== "chore") {
          existing.type = parsed.type;
          existing.title = fetched?.title || parsed.title;
        }
        existing.refs.push(commit.sha);
        existing.commits.push({ sha: commit.sha, date: commit.date, body: commit.body });
      } else {
        prGroups.set(number, {
          title: fetched?.title || parsed.title || `PR #${number}`,
          type: parsed.type,
          prUrl: fetched?.url ?? null,
          refs: [commit.sha],
          commits: [{ sha: commit.sha, date: commit.date, body: commit.body }],
        });
      }
    } else {
      standalone.push({
        sha: commit.sha,
        subject: commit.subject,
        date: commit.date,
        body: commit.body,
      });
    }
  }

  const items: ChangeSummaryItem[] = [];
  for (const [number, group] of prGroups) {
    items.push({
      id: stableId(`#${number}:${group.title}`, group.type),
      title: group.title,
      type: group.type,
      refs: [`#${number}`, ...group.refs],
      github: true,
      prNumber: number,
      prUrl: group.prUrl,
      commits: group.commits,
    });
  }
  for (const commit of standalone) {
    const parsed = parseType(commit.subject);
    items.push({
      id: stableId(commit.sha, parsed.type),
      title: parsed.title,
      type: parsed.type,
      refs: [commit.sha],
      commits: [{ sha: commit.sha, date: commit.date, body: commit.body }],
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
