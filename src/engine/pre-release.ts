/**
 * 发布前检查单的纯函数部分（可单测，无 Electron/网络依赖）：
 * 版本一致性、权限用途说明等自动检查。
 */

export const COMMON_PERMISSION_KEYS = [
  "NSCameraUsageDescription",
  "NSMicrophoneUsageDescription",
  "NSPhotoLibraryUsageDescription",
  "NSLocationWhenInUseUsageDescription",
  "NSContactsUsageDescription",
  "NSCalendarsUsageDescription",
  "NSBluetoothAlwaysUsageDescription",
  "NSUserTrackingUsageDescription",
] as const;

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

export function permissionsCheck(foundKeys: string[]): {
  status: "pass" | "warn";
  detail: string;
} {
  if (foundKeys.length === 0) {
    return {
      status: "warn",
      detail:
        "未发现任何权限用途说明；如应用使用相机/定位/相册等能力，需在 Info.plist 补充用途说明",
    };
  }
  const missing = COMMON_PERMISSION_KEYS.filter(
    (key) => !foundKeys.includes(key),
  );
  return {
    status: "pass",
    detail: `已声明：${foundKeys.join("、")}${
      missing.length
        ? `；常见但缺失：${missing.join("、")}（与功能无关可忽略）`
        : ""
    }`,
  };
}
