import assert from "node:assert";
import {
  buildKeynoteFillScript,
  buildKeynoteInspectionScript,
  buildKeynoteValidationScript,
  KEYNOTE_SCREENSHOT_LAYOUT,
  screenshotPngFileName,
} from "../src/main/keynote-automation";

const validationScript = buildKeynoteValidationScript({ documentPath: "/tmp/Template copy.key" });
assert.match(validationScript, new RegExp(KEYNOTE_SCREENSHOT_LAYOUT.replaceAll(".", "\\.")));
assert.match(validationScript, /every document whose name is documentName/);
assert.match(validationScript, /editableTextItemCount is not 2/);
assert.match(validationScript, /count of images of validationSlide\) is not 1/);
assert.match(validationScript, /close targetDocument saving no/);

const inspectionScript = buildKeynoteInspectionScript({ documentPath: "/tmp/Template copy.key" });
assert.match(inspectionScript, /NATIVE/);
assert.match(inspectionScript, /SAMPLE/);
assert.match(inspectionScript, /title showing of validationSlide/);
assert.match(inspectionScript, /\{\{appilot\.title\}\}/);
assert.match(inspectionScript, /name of base layout of currentSlide/);

const script = buildKeynoteFillScript({
  documentPath: "/tmp/App screenshots.key",
  pages: [{
    language: "zh-Hans",
    screenshotId: "home",
    screenshotName: "首页",
    title: "循\"光\"而行",
    description: "第一行\n第二行",
    imagePath: "/tmp/Home \\ zh.png",
    layoutName: "30 days",
    nativePlaceholders: true,
    sampleSlideNumber: 1,
  }],
});

assert.match(script, /duplicate slide 1 to after last slide[\s\S]*set generatedSlide to last slide/);
assert.match(script, /default title item of generatedSlide/);
assert.match(script, /default body item of generatedSlide/);
assert.match(script, /exactly one editable appilot\.image/);
assert.match(script, /every document whose name is documentName/);
assert.match(script, /循\\"光\\"而行/);
assert.match(script, /第一行 第二行/);
assert.match(script, /appilot:zh-Hans:home/);
assert.match(script, /repeat originalSlideCount times[\s\S]*delete slide 1/);
assert.doesNotMatch(script, /textMaxWidth/);

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
    layoutName: "Settings compact",
    nativePlaceholders: false,
    sampleSlideNumber: 2,
  }],
});
assert.match(exportScript, /as slide images with properties \{image format:PNG\}/);
assert.match(exportScript, /duplicate slide 2 to after last slide/);
assert.match(exportScript, /markerText is "\{\{appilot\.description\}\}"/);
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
