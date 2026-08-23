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

  if (errors === 0) console.log("\n🎉 All asc-key-file tests passed!");
  else process.exitCode = 1;
}

void runTests();
