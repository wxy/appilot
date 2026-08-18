import assert from "node:assert/strict";
import { withDescriptionHeading } from "../src/engine/ai/release-reviewer";
import { sortLanguageCodes } from "../src/engine/storefronts";

console.log("✅ PASS: withDescriptionHeading prefixes marker once");
const marked = withDescriptionHeading("App description");
assert.ok(marked.startsWith("──── 介绍 ────"));
assert.equal(withDescriptionHeading(marked), marked);

console.log("✅ PASS: sortLanguageCodes prioritizes English and zh-Hans");
const sorted = sortLanguageCodes(["de", "zh-Hans", "en", "fr"]);
assert.deepEqual(sorted, ["en", "zh-Hans", "de", "fr"]);

console.log("✅ PASS: sortLanguageCodes keeps unknown languages last");
const sortedUnknown = sortLanguageCodes(["xx", "en", "yy"]);
assert.deepEqual(sortedUnknown, ["en", "xx", "yy"]);

console.log("🎉 All audit utility tests passed!");
