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

function commit(dir: string, file: string, message: string) {
  fs.writeFileSync(path.join(dir, file), message);
  run(dir, ["add", "."]);
  run(dir, ["commit", "-qm", message]);
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

  // A new GitHub draft always uses the latest published release tag as its
  // material boundary, even when Appilot's copy cursor points farther back.
  {
    const dir = setupRepo(["v1.1.2"]);
    commit(dir, "b.txt", "feat: night memory (#28)");
    commit(dir, "c.txt", "fix: HUD hints (#29)");
    const historyStart = execFileSync(
      "git",
      ["-C", dir, "rev-list", "--max-parents=0", "HEAD"],
    ).toString().trim();
    const result = await checkForRelease(dir, historyStart, null, {
      sync: false,
      githubReleases: [
        {
          id: 113,
          tag: "v1.1.3",
          name: "GloWalk 1.1.3",
          body: "draft body",
          draft: true,
          prerelease: false,
          createdAt: "2026-09-12T00:00:00Z",
          publishedAt: null,
          url: "https://github.com/owner/repo/releases/113",
          viaToken: true,
        },
        {
          id: 112,
          tag: "v1.1.2",
          name: "GloWalk 1.1.2",
          body: "published body",
          draft: false,
          prerelease: false,
          createdAt: "2026-08-28T00:00:00Z",
          publishedAt: "2026-08-28T00:00:00Z",
          url: "https://github.com/owner/repo/releases/tag/v1.1.2",
          viaToken: true,
        },
      ],
    });
    const material = result.latest?.material;
    check(material?.commits.length === 2, "GitHub 草案始终仅收集上次已发布 tag 后的提交");
    check(
      material?.commits.every((item) => item.subject.includes("#28") || item.subject.includes("#29")) === true,
      "草案素材不包含 v1.1.2 及更早历史",
    );
    check(material?.pullRequests.length === 2, "草案素材只包含新的 2 个 PR");
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
