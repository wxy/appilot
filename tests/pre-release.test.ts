import assert from "node:assert/strict";
import {
  parsePlistVersion,
  permissionsCheck,
  plistPermissionKeys,
  versionConsistencyCheck,
} from "../src/engine/pre-release";

const plist = `<?xml version="1.0"?>
<plist version="1.0"><dict>
  <key>CFBundleShortVersionString</key><string>1.2.6</string>
  <key>NSCameraUsageDescription</key><string>需要相机用于手电筒闪光</string>
</dict></plist>`;

assert.equal(parsePlistVersion(plist), "1.2.6", "解析版本号");
assert.equal(parsePlistVersion("<plist/>"), null, "无版本号返回 null");
assert.deepEqual(
  plistPermissionKeys(plist),
  ["NSCameraUsageDescription"],
  "识别已声明的权限用途说明",
);

assert.deepEqual(
  versionConsistencyCheck("1.2.6", "v1.2.6"),
  { status: "pass", detail: "代码版本 v1.2.6 = 目标版本 v1.2.6" },
  "版本一致通过",
);
assert.equal(
  versionConsistencyCheck("1.2.5", "1.2.6").status,
  "fail",
  "版本不一致失败",
);
assert.equal(versionConsistencyCheck(null, "1.2.6").status, "unknown", "缺代码版本未知");
assert.equal(versionConsistencyCheck("1.2.6", null).status, "unknown", "缺目标版本未知");

assert.equal(
  permissionsCheck(["NSCameraUsageDescription"]).status,
  "pass",
  "有权限声明通过",
);
assert.equal(permissionsCheck([]).status, "warn", "无权限声明警告");

console.log("🎉 All pre-release tests passed!");
