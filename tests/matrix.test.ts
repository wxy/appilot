import assert from "node:assert/strict";
import { matrixFilterKeywords, trackingLanguageOptions } from "../src/renderer/lib/matrix";

console.log("✅ PASS: trackingLanguageOptions labels en as 全局");
const opts = trackingLanguageOptions([
  { code: "zh-Hans", name: "简体中文" },
  { code: "en", name: "英文" },
]);
assert.deepEqual(opts, [
  { code: "zh-Hans", label: "简体中文" },
  { code: "en", label: "全局" },
]);
assert.deepEqual(trackingLanguageOptions([{ code: "zh-Hans", name: "简体中文" }]), [
  { code: "zh-Hans", label: "简体中文" },
  { code: "en", label: "全局" },
]);

console.log("✅ PASS: matrixFilterKeywords includes viewLang and global en");
const filtered = matrixFilterKeywords(
  [
    { language: "zh-Hans" },
    { language: "en" },
    { language: "ja" },
  ],
  "zh-Hans",
);
assert.deepEqual(filtered, [{ language: "zh-Hans" }, { language: "en" }]);

console.log("🎉 All matrix helper tests passed!");
