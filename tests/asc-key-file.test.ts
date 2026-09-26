import fs from "fs";
import os from "os";
import path from "path";
import { importAscKeyFileTo } from "../src/main/asc-key-file";

let errors = 0;
function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    errors++;
  } else {
    console.log(`✅ PASS: ${msg}`);
  }
}

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "appilot-asc-"));
}

function writeP8(dir: string, name: string, content: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return file;
}

async function runTests() {
  const srcDir = tempDir();
  const keysDir = tempDir();
  const keyA = writeP8(srcDir, "AuthKey_ABC.p8", "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n");
  const keyASame = writeP8(srcDir, "AuthKey_ABC.p8", "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n");
  const keyB = writeP8(srcDir, "AuthKey_XYZ.p8", "-----BEGIN PRIVATE KEY-----\nBBBB\n-----END PRIVATE KEY-----\n");

  const first = importAscKeyFileTo(keysDir, keyA, "project-1");
  assert(fs.existsSync(first), "copy: new key is copied into keys dir");
  assert(path.dirname(first) === keysDir, "copy: destination lives in keys dir");

  const second = importAscKeyFileTo(keysDir, keyASame, "project-1");
  assert(second === first, "dedupe: identical content reuses the existing copy");
  const keyCount = fs.readdirSync(keysDir).filter((f) => f.endsWith(".p8")).length;
  assert(keyCount === 1, "dedupe: identical content does not create a second file");

  // Same basename, different content: must NOT silently reuse the old file.
  const replaced = writeP8(srcDir, "AuthKey_ABC.p8", "-----BEGIN PRIVATE KEY-----\nCCCC\n-----END PRIVATE KEY-----\n");
  const third = importAscKeyFileTo(keysDir, replaced, "project-1");
  assert(third !== first, "same-name different content: returns a new path");
  const afterReplace = fs.readdirSync(keysDir).filter((f) => f.endsWith(".p8"));
  assert(afterReplace.length === 2, "same-name different content: both copies kept");
  assert(
    fs.readFileSync(third, "utf8").includes("CCCC"),
    "same-name different content: new copy contains the new key",
  );

  const other = importAscKeyFileTo(keysDir, keyB, "project-2");
  assert(other !== first && other !== third, "different key: separate managed copy");
  assert(
    importAscKeyFileTo(keysDir, other, "project-2") === other,
    "already-managed path: returned as-is without copying",
  );

  // Permissions (audit L1): managed key copies must be owner-only (0600).
  if (process.platform !== "win32") {
    const modeOf = (p: string) => fs.statSync(p).mode & 0o777;
    assert(modeOf(first) === 0o600, `new copy permission is 0600 (got ${modeOf(first).toString(8)})`);
    assert(modeOf(third) === 0o600, `replacement copy permission is 0600 (got ${modeOf(third).toString(8)})`);
    assert(modeOf(other) === 0o600, `different key copy permission is 0600 (got ${modeOf(other).toString(8)})`);
    // Dedupe hit on a pre-existing loose-permission copy must also tighten it.
    // 注意：keyA 的路径在上文已被 replaced 覆盖为 CCCC 内容，这里用一份新的
    // AAAA 内容文件触发与 first 的内容去重。
    fs.chmodSync(first, 0o644);
    const keyARestored = writeP8(srcDir, "AuthKey_ABC_restore.p8", "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n");
    assert(
      importAscKeyFileTo(keysDir, keyARestored, "project-1") === first,
      "dedupe hit again",
    );
    assert(modeOf(first) === 0o600, "dedupe hit re-tightens loose permission to 0600");

    // Already-managed paths and dedupe hits must also fail closed when the
    // operating system refuses to tighten permissions.
    fs.chmodSync(first, 0o644);
    assert(importAscKeyFileTo(keysDir, first, "project-1") === first, "already-managed path reused");
    assert(modeOf(first) === 0o600, "already-managed path re-tightens loose permission");

    const originalChmod = fs.chmodSync;
    fs.chmodSync = (() => { throw new Error("injected chmod failure"); }) as typeof fs.chmodSync;
    try {
      let managedRejected = false;
      try { importAscKeyFileTo(keysDir, first, "project-1"); } catch { managedRejected = true; }
      assert(managedRejected, "already-managed path rejects chmod failure");

      let dedupeRejected = false;
      try { importAscKeyFileTo(keysDir, keyARestored, "project-1"); } catch { dedupeRejected = true; }
      assert(dedupeRejected, "dedupe hit rejects chmod failure");

      const before = fs.readdirSync(keysDir).filter((f) => f.endsWith(".p8")).length;
      const newKey = writeP8(srcDir, "AuthKey_NEW.p8", "-----BEGIN PRIVATE KEY-----\nDDDD\n-----END PRIVATE KEY-----\n");
      let newCopyRejected = false;
      try { importAscKeyFileTo(keysDir, newKey, "project-3"); } catch { newCopyRejected = true; }
      assert(newCopyRejected, "new copy rejects chmod failure");
      assert(
        fs.readdirSync(keysDir).filter((f) => f.endsWith(".p8")).length === before,
        "new copy leaves no partial managed key after chmod failure",
      );
    } finally {
      fs.chmodSync = originalChmod;
    }
  }

  if (errors === 0) console.log("\n🎉 All asc-key-file tests passed!");
  else process.exitCode = 1;
}

void runTests();
