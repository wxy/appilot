import fs from "fs";
import path from "path";
import { log } from "./logger";

export interface ReleaseInfo {
  id: string;
  tag: string;
  name: string | null;
  publishedAt: string;
  url: string;
  body: string;
  source: "release-draft-file";
  draft: boolean;
}

export interface ReleaseCheckResult {
  latest: ReleaseInfo | null;
  isNew: boolean;
  lastSeenTag: string | null;
  releases: ReleaseInfo[];
}

const RELEASE_DRAFT_FILENAME = "RELEASE_DRAFT.md";

function firstHeading(content: string): string | null {
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) {
      return trimmed.replace(/^#+\s*/, "").trim() || null;
    }
    return trimmed;
  }
  return null;
}

function readReleaseDraft(localPath: string): ReleaseInfo | null {
  const filePath = path.join(localPath, RELEASE_DRAFT_FILENAME);
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const stat = fs.statSync(filePath);
    const modifiedAt = stat.mtime.toISOString();
    const draftId = `draft-${stat.mtimeMs}`;

    return {
      id: draftId,
      tag: draftId,
      name: firstHeading(content) || RELEASE_DRAFT_FILENAME,
      publishedAt: modifiedAt,
      url: "",
      body: content,
      source: "release-draft-file",
      draft: true,
    };
  } catch (err: any) {
    if (err?.code !== "ENOENT") {
      log.warn(`Failed to read ${RELEASE_DRAFT_FILENAME}: ${err.message}`);
    }
    return null;
  }
}

export async function checkForRelease(
  localPath: string,
  lastSeenTag?: string | null,
  _legacyGithubToken?: string | null,
): Promise<ReleaseCheckResult> {
  const draft = readReleaseDraft(localPath);
  const releases = draft ? [draft] : [];
  const latest = draft || null;
  const isNew = Boolean(latest && latest.tag !== lastSeenTag);

  return {
    latest,
    isNew,
    lastSeenTag: lastSeenTag || null,
    releases,
  };
}
