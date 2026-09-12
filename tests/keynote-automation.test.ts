import assert from "node:assert";
import { buildKeynoteFillScript, KEYNOTE_SCREENSHOT_LAYOUT, screenshotPngFileName } from "../src/main/keynote-automation";

const script = buildKeynoteFillScript({
  documentPath: "/tmp/App screenshots.key",
  pages: [{
    language: "zh-Hans",
    screenshotId: "home",
    screenshotName: "首页",
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
assert.match(script, /set textMaxWidth to \(width of targetDocument\) \* 0\.8/);

const exportScript = buildKeynoteFillScript({
  documentPath: "/tmp/App screenshots.key",
  exportPngDirectory: "/tmp/App PNG",
  pages: [{
    language: "en",
    screenshotId: "settings",
    screenshotName: "Settings",
    title: "Settings",
    description: "Make it yours",
    imagePath: "/tmp/settings.png",
  }],
});
assert.match(exportScript, /as slide images with properties \{image format:PNG\}/);
assert.equal(
  screenshotPngFileName({
    language: "zh-Hans",
    screenshotId: "home",
    screenshotName: "首页 / 夜间",
    title: "",
    description: "",
    imagePath: "/tmp/home.png",
  }, 0),
  "01-zh-Hans-首页-夜间.png",
);

console.log("All Keynote automation tests passed ✅");
