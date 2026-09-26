import crypto from "crypto";
import fs from "fs";
import path from "path";

function fileHash(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex").slice(0, 12);
}

/**
 * Copy a selected .p8 key into the managed keys directory, deduplicated by
 * content:
 * - an identical file that already exists in the directory is reused (no
 *   duplicate copies);
 * - a different file with the same basename gets a content-hash suffix, so
 *   replacing the key never silently keeps pointing at the old file.
 */
export function importAscKeyFileTo(
  keysDir: string,
  sourcePath: string,
  tag: string,
): string {
  const src = sourcePath.trim();
  if (!src) return "";
  if (!fs.existsSync(src)) throw new Error("无法读取 .p8 私钥文件");
  // Already managed by the app (e.g. a stored copy picked during re-enter):
  // keep that path as-is instead of copying it again.
  if (path.dirname(src) === keysDir) {
    tightenKeyFilePermissions(src);
    return src;
  }

  fs.mkdirSync(keysDir, { recursive: true });
  const srcHash = fileHash(src);
  for (const file of fs.readdirSync(keysDir)) {
    if (!file.toLowerCase().endsWith(".p8")) continue;
    const candidate = path.join(keysDir, file);
    let matches = false;
    try {
      matches = fileHash(candidate) === srcHash;
    } catch {
      // Unreadable file — ignore and keep scanning.
      continue;
    }
    if (matches) {
      tightenKeyFilePermissions(candidate);
      return candidate;
    }
  }
  const base = path
    .basename(src, path.extname(src))
    .replace(/[^A-Za-z0-9_-]/g, "_");
  const dest = path.join(
    keysDir,
    `asc-${tag}-${base}-${srcHash.slice(0, 8)}.p8`,
  );
  // Create privately from the first byte; copyFileSync may inherit a broad
  // source mode before the later chmod has a chance to tighten it.
  fs.writeFileSync(dest, fs.readFileSync(src), { flag: "wx", mode: 0o600 });
  try {
    tightenKeyFilePermissions(dest);
  } catch (err) {
    fs.rmSync(dest, { force: true });
    throw err;
  }
  return dest;
}

/**
 * ASC 私钥副本仅本用户可读写（审计 2026-09-26 L1）：copyFileSync 产物继承
 * 默认权限（通常 0644，组/其他用户可读）。对新副本与命中的已有副本都幂等
 * 收紧到 0600；POSIX 上失败必须中止，不能返回权限宽松的私钥路径。
 */
function tightenKeyFilePermissions(filePath: string): void {
  try {
    fs.chmodSync(filePath, 0o600);
  } catch (err) {
    if (process.platform !== "win32") throw err;
  }
}
