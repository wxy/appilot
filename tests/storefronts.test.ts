import {
  defaultStorefrontForLanguage,
  isStorefrontAllowedForQueryLanguage,
  storefrontsForLanguage,
} from "../src/engine/storefronts";

let errors = 0;
function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    errors++;
  } else {
    console.log(`✅ PASS: ${msg}`);
  }
}

assert(storefrontsForLanguage("zh-Hans").includes("cn"), "zh-Hans maps to cn");
assert(!storefrontsForLanguage("zh-Hans").includes("us"), "zh-Hans does not map to us");
assert(defaultStorefrontForLanguage("de") === "de", "de defaults to de");
assert(isStorefrontAllowedForQueryLanguage("zh-Hans", "cn"), "zh-Hans is allowed in cn");
assert(!isStorefrontAllowedForQueryLanguage("zh-Hans", "us"), "zh-Hans is not allowed in us");
assert(isStorefrontAllowedForQueryLanguage("en", "cn"), "English is allowed in cn");

console.log(`\n${errors === 0 ? "🎉 All storefront tests passed!" : `❌ ${errors} test(s) failed`}`);
process.exit(errors > 0 ? 1 : 0);
