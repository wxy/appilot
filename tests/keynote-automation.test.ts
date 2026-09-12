import assert from "node:assert";
import { buildKeynoteFillScript, KEYNOTE_SCREENSHOT_LAYOUT } from "../src/main/keynote-automation";

const script = buildKeynoteFillScript({
  documentPath: "/tmp/App screenshots.key",
  pages: [{
    language: "zh-Hans",
    screenshotId: "home",
    title: "循\"光\"而行",
    description: "第一行\n第二行",
    imagePath: "/tmp/Home \\ zh.png",
  }],
});

assert.match(script, new RegExp(KEYNOTE_SCREENSHOT_LAYOUT.replaceAll(".", "\\.")));
assert.match(script, /exactly one layout named/);
assert.match(script, /exactly two editable text placeholders/);
assert.match(script, /exactly one editable appilot\.image/);
assert.match(script, /every document whose name is documentName/);
assert.match(script, /循\\"光\\"而行/);
assert.match(script, /第一行 第二行/);
assert.match(script, /appilot:zh-Hans:home/);
assert.match(script, /repeat originalSlideCount times[\s\S]*delete slide 1/);

console.log("All Keynote automation tests passed ✅");
