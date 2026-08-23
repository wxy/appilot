import { filterTasksForRemovedProject } from "../src/main/task-cleanup";

let errors = 0;
function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    errors++;
  } else {
    console.log(`✅ PASS: ${msg}`);
  }
}

const tasks = [
  { id: "r1", kind: "rank", productId: "p1" },
  { id: "r2", kind: "rank", productId: "p2" },
  { id: "r3", kind: "rank", productId: "p1" },
  { id: "s1", kind: "github-sync", projectId: "proj-1" },
  { id: "s2", kind: "github-sync", projectId: "proj-2" },
];

async function runTests() {
  const kept = filterTasksForRemovedProject(
    tasks,
    new Set(["p1"]),
    "proj-1",
  );
  assert(!kept.some((t) => t.id === "r1"), "rank tasks of removed products are removed");
  assert(!kept.some((t) => t.id === "r3"), "second rank task of removed product is removed");
  assert(kept.some((t) => t.id === "r2"), "rank tasks of other products are kept");
  assert(!kept.some((t) => t.id === "s1"), "github-sync task of removed project is removed");
  assert(kept.some((t) => t.id === "s2"), "github-sync task of other project is kept");

  const nothingRemoved = filterTasksForRemovedProject(tasks, new Set(), "proj-none");
  assert(nothingRemoved.length === tasks.length, "no matching ids keeps all tasks");

  if (errors === 0) console.log("\n🎉 All task-cleanup tests passed!");
  else process.exitCode = 1;
}

void runTests();
