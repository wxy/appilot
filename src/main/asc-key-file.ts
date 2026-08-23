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
  if (path.dirname(src) === keysDir) return src;

  fs.mkdirSync(keysDir, { recursive: true });
  const srcHash = fileHash(src);
  for (const file of fs.readdirSync(keysDir)) {
    if (!file.toLowerCase().endsWith(".p8")) continue;
    const candidate = path.join(keysDir, file);
    try {
      if (fileHash(candidate) === srcHash) return candidate;
    } catch {
      // Unreadable file — ignore and keep scanning.
    }
  }
  const base = path
    .basename(src, path.extname(src))
    .replace(/[^A-Za-z0-9_-]/g, "_");
  const dest = path.join(
    keysDir,
    `asc-${tag}-${base}-${srcHash.slice(0, 8)}.p8`,
  );
  fs.copyFileSync(src, dest);
  return dest;
}
