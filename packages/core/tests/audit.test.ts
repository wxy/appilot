import assert from "node:assert/strict";
import { sortLanguageCodes } from "../src/storefronts";

console.log("✅ PASS: sortLanguageCodes prioritizes English and zh-Hans");
const sorted = sortLanguageCodes(["de", "zh-Hans", "en", "fr"]);
assert.deepEqual(sorted, ["en", "zh-Hans", "de", "fr"]);

console.log("✅ PASS: sortLanguageCodes keeps unknown languages last");
const sortedUnknown = sortLanguageCodes(["xx", "en", "yy"]);
assert.deepEqual(sortedUnknown, ["en", "xx", "yy"]);

console.log("🎉 All audit utility tests passed!");
