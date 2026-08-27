/**
 * 发布前检查单的纯函数部分（可单测，无 Electron/网络依赖）：
 * 版本一致性、权限用途说明等自动检查。
 */

export const COMMON_PERMISSION_KEYS = [
  "NSCameraUsageDescription",
  "NSMicrophoneUsageDescription",
  "NSPhotoLibraryUsageDescription",
  "NSPhotoLibraryAddUsageDescription",
  "NSLocationWhenInUseUsageDescription",
  "NSLocationAlwaysUsageDescription",
  "NSContactsUsageDescription",
  "NSCalendarsUsageDescription",
  "NSMotionUsageDescription",
  "NSBluetoothAlwaysUsageDescription",
  "NSHealthShareUsageDescription",
  "NSHealthUpdateUsageDescription",
  "NSUserTrackingUsageDescription",
  "NSRemindersUsageDescription",
  "NSSpeechRecognitionUsageDescription",
] as const;

/** 权限用途说明键 → 人类可读名称。 */
export const PERMISSION_LABELS: Record<string, string> = {
  NSCameraUsageDescription: "相机",
  NSMicrophoneUsageDescription: "麦克风",
  NSPhotoLibraryUsageDescription: "相册（读取）",
  NSPhotoLibraryAddUsageDescription: "保存到相册",
  NSLocationWhenInUseUsageDescription: "定位（使用期间）",
  NSLocationAlwaysUsageDescription: "定位（始终）",
  NSContactsUsageDescription: "通讯录",
  NSCalendarsUsageDescription: "日历",
  NSMotionUsageDescription: "运动与健身",
  NSBluetoothAlwaysUsageDescription: "蓝牙",
  NSHealthShareUsageDescription: "健康数据（读取）",
  NSHealthUpdateUsageDescription: "健康数据（写入）",
  NSUserTrackingUsageDescription: "广告跟踪（ATT）",
  NSRemindersUsageDescription: "提醒事项",
  NSSpeechRecognitionUsageDescription: "语音识别",
};

/** 能力（entitlements）键 → 人类可读名称。 */
export const CAPABILITY_LABELS: Record<string, string> = {
  "com.apple.developer.healthkit": "HealthKit（健康数据）",
  "com.apple.developer.weatherkit": "WeatherKit（天气数据）",
  "com.apple.security.app-sandbox": "App Sandbox（沙盒）",
  "com.apple.developer.icloud-container-identifiers": "iCloud 容器",
  "com.apple.developer.ubiquity-kvstore-identifier": "iCloud 键值存储",
  "aps-environment": "推送通知",
  "application-identifier": "应用标识",
  "keychain-access-groups": "钥匙串访问组",
};

export function permissionLabel(key: string): string {
  return PERMISSION_LABELS[key] || key;
}

export function capabilityLabel(key: string): string {
  return CAPABILITY_LABELS[key] || key;
}

/** 从 Info.plist 文本中提取 CFBundleShortVersionString。 */
export function parsePlistVersion(content: string): string | null {
  const match = content.match(
    /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]*)<\/string>/,
  );
  return match && match[1].trim() ? match[1].trim() : null;
}

/** 列出 Info.plist 文本中已声明的常见权限用途说明键。 */
export function plistPermissionKeys(content: string): string[] {
  return COMMON_PERMISSION_KEYS.filter((key) =>
    content.includes(`<key>${key}</key>`),
  );
}

/** 从 Xcode project.pbxproj 文本中提取版本（MARKETING_VERSION），多 target 取第一个语义版本。 */
export function parsePbxprojVersion(content: string): string | null {
  const matches = Array.from(
    content.matchAll(/MARKETING_VERSION\s*=\s*([^;\s]+)/g),
  ).map((match) => match[1].replace(/["']/g, ""));
  return (
    matches.find((value) => /^\d+(\.\d+)*$/.test(value)) ||
    matches[0] ||
    null
  );
}

/** 从 project.pbxproj 文本中提取构建号（CURRENT_PROJECT_VERSION）。 */
export function parsePbxprojBuildNumber(content: string): string | null {
  const match = content.match(
    /CURRENT_PROJECT_VERSION\s*=\s*([^;\s]+)/,
  );
  return match ? match[1].replace(/["']/g, "") : null;
}

/** 从 project.pbxproj 中识别通过 INFOPLIST_KEY_* build settings 声明的权限用途说明。 */
export function pbxprojPermissionKeys(content: string): string[] {
  return COMMON_PERMISSION_KEYS.filter((key) =>
    content.includes(`INFOPLIST_KEY_${key}`),
  );
}

/** 从 entitlements 文本中提取声明的能力键（capabilities）。 */
export function entitlementKeys(content: string): string[] {
  const keys = Array.from(
    content.matchAll(/<key>([^<]+)<\/key>/g),
  ).map((match) => match[1]);
  return keys.filter(
    (key) =>
      /^(com\.apple|aps-|application-identifier|keychain-access-groups)/.test(
        key,
      ),
  );
}

/** 统计 InfoPlist.xcstrings 中某个权限键的本地化语言数（0 = 无本地化/未找到）。 */
export function xcstringsLocalizationCount(
  content: string,
  key: string,
): number {
  try {
    const data = JSON.parse(content);
    const entry = data?.strings?.[key];
    const localizations = entry?.localizations;
    return localizations && typeof localizations === "object"
      ? Object.keys(localizations).length
      : 0;
  } catch {
    return 0;
  }
}

export function versionConsistencyCheck(
  codeVersion: string | null,
  targetVersion: string | null,
): { status: "pass" | "fail" | "unknown"; detail: string } {
  if (!codeVersion) {
    return {
      status: "unknown",
      detail: "未在仓库中找到代码版本号（CFBundleShortVersionString）",
    };
  }
  if (!targetVersion) {
    return {
      status: "unknown",
      detail: `代码版本 v${codeVersion}，目标版本未确定`,
    };
  }
  const code = String(codeVersion).trim().replace(/^v/i, "");
  const target = String(targetVersion).trim().replace(/^v/i, "");
  if (code === target) {
    return {
      status: "pass",
      detail: `代码版本 v${code} = 目标版本 v${target}`,
    };
  }
  return {
    status: "fail",
    detail: `代码版本 v${code} ≠ 目标版本 v${target}`,
  };
}

export function buildNumberConsistencyCheck(
  codeBuildNumber: string | null,
  targetBuildNumber: string | null,
): { status: "pass" | "fail" | "unknown"; detail: string } {
  if (!codeBuildNumber) {
    return {
      status: "unknown",
      detail:
        "未在仓库中找到构建号（CURRENT_PROJECT_VERSION / CFBundleVersion）",
    };
  }
  if (!targetBuildNumber) {
    return {
      status: "unknown",
      detail: `代码构建号 ${codeBuildNumber}，目标构建号未确定`,
    };
  }
  if (String(codeBuildNumber).trim() === String(targetBuildNumber).trim()) {
    return {
      status: "pass",
      detail: `构建号 ${codeBuildNumber} 一致`,
    };
  }
  return {
    status: "fail",
    detail: `代码构建号 ${codeBuildNumber} ≠ 目标构建号 ${targetBuildNumber}`,
  };
}

export function permissionsCheck(
  foundKeys: string[],
  coverage: Record<string, number> = {},
): {
  status: "pass" | "warn";
  detail: string;
  items: { label: string; kind: "permission" | "capability" }[];
} {
  if (foundKeys.length === 0) {
    return {
      status: "warn",
      detail:
        "未在仓库中发现任何权限用途说明（INFOPLIST_KEY_* / Info.plist / InfoPlist.xcstrings）；如应用使用相机/定位/相册/健康等能力，需补充用途说明",
      items: [],
    };
  }
  const items = foundKeys.map((key) => ({
    label: `${permissionLabel(key)}${
      coverage[key] ? `（${coverage[key]} 语言本地化）` : ""
    }`,
    kind: "permission" as const,
  }));
  return {
    status: "pass",
    detail: `已声明 ${items.length} 项权限用途说明`,
    items,
  };
}
