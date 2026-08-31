/**
 * Release watcher GitHub-first source test.
 * With a GitHub releases listing (drafts included) the candidates come from
 * GitHub; without one the watcher degrades to local main-line git tags.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { checkForRelease } from "../src/release-watcher";

let errors = 0;
function check(ok: boolean, msg: string) {
  if (ok) console.log(`✅ PASS: ${msg}`);
  else { console.error(`❌ FAIL: ${msg}`); errors++; }
}

function run(dir: string, args: string[]) {
  execFileSync("git", ["-C", dir, ...args], { stdio: "pipe" });
}

function setupRepo(tags: string[] = []): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "appilot-relgh-"));
  run(dir, ["init", "-q"]);
  run(dir, ["config", "user.email", "t@example.com"]);
  run(dir, ["config", "user.name", "T"]);
  run(dir, ["branch", "-M", "master"]);
  fs.writeFileSync(path.join(dir, "a.txt"), "base\n");
  run(dir, ["add", "."]);
  run(dir, ["commit", "-qm", "base"]);
  for (const tag of tags) run(dir, ["tag", tag]);
  return dir;
}

async function runTests() {
  // GitHub-first path: draft listed first, untagged draft gets gh-{id} tag.
  {
    const dir = setupRepo();
    const result = await checkForRelease(dir, null, null, {
      sync: false,
      githubReleases: [
        {
          id: 2,
          tag: "v1.1.1",
          name: "v1.1.1",
          body: "published body",
          draft: false,
          prerelease: false,
          createdAt: "2026-08-20T00:00:00Z",
          publishedAt: "2026-08-20T00:00:00Z",
          url: "https://github.com/owner/repo/releases/tag/v1.1.1",
          viaToken: true,
        },
        {
          id: 1,
          tag: null,
          name: "v1.2.0 WIP",
          body: "draft body",
          draft: true,
          prerelease: false,
          createdAt: "2026-08-21T00:00:00Z",
          publishedAt: null,
          url: "https://github.com/owner/repo/releases/1",
          viaToken: true,
        },
      ],
    });
    check(result.releases.length === 2, "GitHub-first: 2 candidates");
    check(result.releases[0].id === "gh-1", "draft 优先排在前面");
    check(result.releases[0].tag === "gh-1", "未打 tag 的草案回退 gh-{id}");
    check(result.releases[0].githubDraft === true, "草案 githubDraft=true");
    check(result.releases[0].source === "github-release", "草案 source=github-release");
    check(result.releases[0].name === "v1.2.0 WIP", "草案 name 保留");
    check(result.releases[1].tag === "v1.1.1", "已发布 release tag 保留");
    check(result.releases[1].githubDraft === false, "已发布 githubDraft=false");
    check(
      result.releases[1].material?.githubRelease?.body === "published body",
      "GitHub 公告写入 material",
    );
    check(result.latest?.id === "gh-1", "latest 为最新草案");
  }

  // No GitHub releases → degrade to local main-line git tag.
  {
    const dir = setupRepo(["v1.0.0"]);
    const result = await checkForRelease(dir, null, null, {
      sync: false,
      githubReleases: [],
    });
    check(result.latest?.tag === "v1.0.0", "无 GitHub 数据 → 本地 tag 候选");
    check(result.latest?.source === "git-tag", "降级后 source=git-tag");
    check(result.latest?.githubDraft === null, "降级后 githubDraft=null（未知）");
  }

  // GitHub releases plus an extra main-line tag not covered by GitHub.
  {
    const dir = setupRepo(["v1.0.0"]);
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any) => {
      const url = typeof input === "string" ? input : String(input);
      if (url.includes("/pulls/")) {
        return new Response(
          JSON.stringify({ title: "PR real title", html_url: url }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    }) as any;
    try {
      const result = await checkForRelease(dir, null, null, {
        sync: false,
        githubReleases: [
          {
            id: 9,
            tag: "v1.1.1",
            name: "v1.1.1",
            body: "",
            draft: false,
            prerelease: false,
            createdAt: "2026-08-20T00:00:00Z",
            publishedAt: "2026-08-20T00:00:00Z",
            url: "https://github.com/owner/repo/releases/tag/v1.1.1",
            viaToken: false,
          },
        ],
      });
      const extra = result.releases.find((item) => item.tag === "v1.0.0");
      check(Boolean(extra), "未被 GitHub 覆盖的主线 tag 被补充");
      check(extra?.source === "git-tag" && extra?.githubDraft === null, "补充项标记为本地标签");
      check(result.releases[0].tag === "v1.1.1", "GitHub release 排在前");
    } finally {
      globalThis.fetch = origFetch;
    }
  }

  if (errors) process.exit(1);
  console.log("done");
}

void runTests();
