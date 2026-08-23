import {
  assertNonEmptyString,
  assertStringArray,
  dedupeProjects,
  normalizeLocalPath,
} from "../src/main/util";

let errors = 0;
function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    errors++;
  } else {
    console.log(`✅ PASS: ${msg}`);
  }
}

async function runTests() {
  assert(normalizeLocalPath("") === "", "normalizeLocalPath empty");
  assert(normalizeLocalPath("   ") === "", "normalizeLocalPath whitespace");
  assert(normalizeLocalPath(123 as any) === "", "normalizeLocalPath non-string");
  assert(
    normalizeLocalPath("/a/../b") === "/b",
    "normalizeLocalPath resolves .. segments",
  );

  assert(assertNonEmptyString("x", "x") === "x", "assertNonEmptyString trims");
  let threw = false;
  try {
    assertNonEmptyString("", "x");
  } catch {
    threw = true;
  }
  assert(threw, "assertNonEmptyString throws on empty");

  assert(
    JSON.stringify(assertStringArray(["a", "a", "b"], "x")) === JSON.stringify(["a", "b"]),
    "assertStringArray dedupes",
  );
  threw = false;
  try {
    assertStringArray(["a", 1] as any, "x");
  } catch {
    threw = true;
  }
  assert(threw, "assertStringArray rejects non-strings");

  const deduped = dedupeProjects([
    { id: "a", localPath: "/p/a" },
    { id: "b", localPath: "/p/b" },
    { id: "c", localPath: "/p/a" },
  ]);
  assert(deduped.length === 2, "dedupeProjects keeps one per path");
  assert(
    deduped.some((p) => p.id === "c") && !deduped.some((p) => p.id === "a"),
    "dedupeProjects keeps the latest project for a path",
  );

  if (errors === 0) console.log("\n🎉 All util tests passed!");
  else process.exitCode = 1;
}

void runTests();
