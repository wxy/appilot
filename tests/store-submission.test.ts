import { inferAppVersion } from "../src/engine/store-submission";

let errors = 0;
function check(ok: boolean, msg: string) {
  if (ok) console.log(`✅ PASS: ${msg}`);
  else { console.error(`❌ FAIL: ${msg}`); errors++; }
}

// inferAppVersion: git tag is the primary source.
check(inferAppVersion({ tag: "v1.1.1", name: "v1.1.1" } as any) === "1.1.1", "tag v1.1.1 → 1.1.1");
check(inferAppVersion({ tag: "1.0", name: "1.0" } as any) === "1.0", "tag 1.0 → 1.0");
check(inferAppVersion({ tag: "head-abc", name: "待处理变更" } as any) === "", "无版本号 → 空");

// Untagged GitHub drafts: fall back to the release name.
check(
  inferAppVersion({ tag: "gh-1", name: "v1.2.0 WIP" } as any) === "1.2.0",
  "草案 name v1.2.0 WIP → 1.2.0",
);
check(
  inferAppVersion({ tag: "gh-1", name: "GloWalk 1.1.1" } as any) === "1.1.1",
  "草案 name GloWalk 1.1.1 → 1.1.1",
);
check(
  inferAppVersion({ tag: "gh-1", name: "no version here" } as any) === "",
  "草案 name 无版本 → 空（用户手动填写）",
);

if (errors) process.exit(1);
console.log("done");
