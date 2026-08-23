import { matrixRankText, matrixTrendText } from "../src/renderer/components/keywords/matrix";

let errors = 0;
function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    errors++;
  } else {
    console.log(`✅ PASS: ${msg}`);
  }
}

const cell = (overrides: Record<string, unknown>) =>
  ({
    keyword: "k",
    language: "en",
    rank: null,
    trend: "same",
    delta: null,
    beyond200: false,
    stale: false,
    ...overrides,
  }) as any;

async function runTests() {
  assert(matrixRankText(cell({ rank: 3 })) === "3", "rank text");
  assert(matrixRankText(cell({ rank: null })) === "—", "no rank → —");
  assert(matrixRankText(cell({ beyond200: true })) === "200+", "beyond 200");

  assert(matrixTrendText(cell({ trend: "new" })) === "进榜", "new trend");
  assert(matrixTrendText(cell({ trend: "lost" })) === "掉榜", "lost trend");
  assert(matrixTrendText(cell({ trend: "up", delta: 4 })) === "▲ 4", "up trend");
  assert(matrixTrendText(cell({ trend: "down", delta: -4 })) === "▼ 4", "down trend abs");
  assert(matrixTrendText(cell({ trend: "same" })) === null, "same trend → null");

  if (errors === 0) console.log("\n🎉 All matrix-helper tests passed!");
  else process.exitCode = 1;
}

void runTests();
