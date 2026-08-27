import assert from "node:assert/strict";
import {
  parsePlistVersion,
  parsePbxprojVersion,
  entitlementKeys,
  permissionsCheck,
  pbxprojPermissionKeys,
  plistPermissionKeys,
  versionConsistencyCheck,
  xcstringsLocalizationCount,
} from "../src/engine/pre-release";

const plist = `<?xml version="1.0"?>
<plist version="1.0"><dict>
  <key>CFBundleShortVersionString</key><string>1.2.6</string>
  <key>NSCameraUsageDescription</key><string>需要相机用于手电筒闪光</string>
</dict></plist>`;

assert.equal(parsePlistVersion(plist), "1.2.6", "解析版本号");
assert.equal(parsePlistVersion("<plist/>"), null, "无版本号返回 null");

const pbxproj = `
// !$*UTF8*$!
{
  buildSettings = {
    MARKETING_VERSION = 1.2.6;
    CURRENT_PROJECT_VERSION = 17;
    INFOPLIST_KEY_NSCameraUsageDescription = "相机用于手电筒";
  };
}
`;
assert.equal(parsePbxprojVersion(pbxproj), "1.2.6", "从 pbxproj 提取 MARKETING_VERSION");
assert.deepEqual(
  pbxprojPermissionKeys(pbxproj),
  ["NSCameraUsageDescription"],
  "从 pbxproj 识别 INFOPLIST_KEY_ 权限",
);
assert.deepEqual(
  entitlementKeys('<plist><dict><key>com.apple.security.app-sandbox</key><true/></dict></plist>'),
  ["com.apple.security.app-sandbox"],
  "从 entitlements 提取能力键",
);
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

const xcstrings = JSON.stringify({
  strings: {
    NSCameraUsageDescription: {
      localizations: {
        en: { stringUnit: { state: "translated", value: "camera" } },
        "zh-Hans": { stringUnit: { state: "translated", value: "相机" } },
      },
    },
  },
});
assert.equal(
  xcstringsLocalizationCount(xcstrings, "NSCameraUsageDescription"),
  2,
  "统计 xcstrings 本地化语言数",
);
assert.equal(
  xcstringsLocalizationCount(xcstrings, "NSMotionUsageDescription"),
  0,
  "未找到的键返回 0",
);
assert(
  permissionsCheck(["NSMotionUsageDescription", "NSCameraUsageDescription"], {
    NSCameraUsageDescription: 11,
  }).detail.includes("11 语言本地化"),
  "权限检查带本地化覆盖信息",
);

console.log("🎉 All pre-release tests passed!");
