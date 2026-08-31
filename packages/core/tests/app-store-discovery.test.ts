/**
 * Apple product detection + App Store link discovery tests (no network).
 */

import fs from "fs";
import os from "os";
import path from "path";
import {
  detectApplePlatform,
  detectLocalizedLanguages,
  discoverAppStoreTrackId,
  extractAppStoreLinks,
  localizedStoreLinks,
} from "../src/app-store-discovery";

let errors = 0;
function assert(condition: boolean, msg: string) {
  if (!condition) { console.error(`❌ FAIL: ${msg}`); errors++; }
  else { console.log(`✅ PASS: ${msg}`); }
}

function makeFixture(setup: (dir: string) => void): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "appilot-test-"));
  setup(dir);
  return dir;
}

// 1. iOS detection (SDKROOT = iphoneos)
const iosDir = makeFixture((dir) => {
  const proj = path.join(dir, "App.xcodeproj");
  fs.mkdirSync(proj);
  fs.writeFileSync(path.join(proj, "project.pbxproj"), "SDKROOT = iphoneos;\n");
});
assert(detectApplePlatform(iosDir) === "ios", "detect: iphoneos → ios");

// 2. macOS detection (SDKROOT = macosx)
const macDir = makeFixture((dir) => {
  const proj = path.join(dir, "App.xcodeproj");
  fs.mkdirSync(proj);
  fs.writeFileSync(path.join(proj, "project.pbxproj"), "SDKROOT = macosx;\n");
});
assert(detectApplePlatform(macDir) === "macos", "detect: macosx → macos");

// 3. both platforms → macos wins
const bothDir = makeFixture((dir) => {
  const macProj = path.join(dir, "Mac.xcodeproj");
  fs.mkdirSync(macProj);
  fs.writeFileSync(path.join(macProj, "project.pbxproj"), "SDKROOT = macosx;\n");
  const iosProj = path.join(dir, "iOS.xcodeproj");
  fs.mkdirSync(iosProj);
  fs.writeFileSync(path.join(iosProj, "project.pbxproj"), "SDKROOT = iphoneos;\n");
});
assert(detectApplePlatform(bothDir) === "macos", "detect: macos wins over ios");

// 4. non-Apple repo → null
const emptyDir = makeFixture(() => {});
assert(detectApplePlatform(emptyDir) === null, "detect: non-Apple → null");

// 5. App Store link with mt=12
const linkDir = makeFixture((dir) => {
  fs.writeFileSync(
    path.join(dir, "README.md"),
    "Download: https://apps.apple.com/us/app/ai-pulse/id6786290416?mt=12",
  );
});
const link = discoverAppStoreTrackId(linkDir);
assert(link?.trackId === "6786290416" && link?.mt === "12", "discover: apps.apple.com id+mt");

// 6. itunes.apple.com link without mt
const itunesDir = makeFixture((dir) => {
  fs.writeFileSync(path.join(dir, "README.md"), "https://itunes.apple.com/app/id987654321");
});
const itunesLink = discoverAppStoreTrackId(itunesDir);
assert(itunesLink?.trackId === "987654321" && itunesLink?.mt === null, "discover: itunes.apple.com id");

// 7. no README → null
assert(discoverAppStoreTrackId(emptyDir) === null, "discover: no README → null");

// 8. README without App Store link → null
const noLinkDir = makeFixture((dir) => {
  fs.writeFileSync(path.join(dir, "README.md"), "No app store link here.");
});
assert(discoverAppStoreTrackId(noLinkDir) === null, "discover: no link → null");

// 9. extract multiple storefronts with country codes
const multiLinks = extractAppStoreLinks(`
[US](https://apps.apple.com/us/app/x/id111111111)
[CN](https://apps.apple.com/cn/app/x/id111111111)
[GB](https://apps.apple.com/gb/app/x/id111111111)
`);
assert(multiLinks.length === 3, "extract: 3 storefront links");
assert(multiLinks.map((l) => l.country).join(",") === "us,cn,gb", "extract: country codes preserved");
assert(multiLinks[0].trackId === "111111111", "extract: trackId captured");

// 10. localizedStoreLinks maps each link's region and keeps both platforms
const localized = localizedStoreLinks([
  { country: "us", trackId: "111111111", mt: "8", url: "https://apps.apple.com/us/app/x/id111111111" },
  { country: "us", trackId: "111111111", mt: "12", url: "https://apps.apple.com/us/app/x/id111111111?mt=12" },
  { country: "cn", trackId: "111111111", mt: "8", url: "https://apps.apple.com/cn/app/x/id111111111" },
  { country: "jp", trackId: "111111111", mt: "8", url: "https://apps.apple.com/jp/app/x/id111111111" },
]);
assert(localized.length === 4, "localize: maps all four links");
assert(localized[0].platform === "ios" && localized[0].name === "美国", "localize: us iOS listed");
assert(localized[1].platform === "macos" && localized[1].name === "美国", "localize: us macOS also listed");
assert(localized[2].name === "中国大陆", "localize: cn → 中国大陆");
assert(localized[3].name === "日本", "localize: jp → 日本");

// 11. detectLocalizedLanguages merges .lproj directories and Info.plist
const langDir = makeFixture((dir) => {
  fs.mkdirSync(path.join(dir, "App.xcodeproj"));
  fs.mkdirSync(path.join(dir, "en.lproj"));
  fs.mkdirSync(path.join(dir, "zh-Hans.lproj"));
  fs.mkdirSync(path.join(dir, "ja.lproj"));
  fs.writeFileSync(
    path.join(dir, "App.xcodeproj", "Info.plist"),
    "<key>CFBundleDevelopmentRegion</key><string>en</string>\n" +
      "<key>CFBundleLocalizations</key><array><string>de</string><string>fr</string></array>",
  );
});
const langs = detectLocalizedLanguages(langDir);
assert(
  ["en", "zh-Hans", "ja", "de", "fr"].every((l) => langs.includes(l)),
  "detect languages: .lproj + plist merged",
);

// 12. detectLocalizedLanguages parses SwiftUI String Catalog (.xcstrings)
const xcDir = makeFixture((dir) => {
  const src = path.join(dir, "Sources");
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(
    path.join(src, "Localizable.xcstrings"),
    JSON.stringify({
      sourceLanguage: "en",
      strings: {
        hello: { localizations: { en: {}, de: {}, "zh-Hant-HK": {}, "pt-BR": {} } },
      },
    }),
  );
});
const xcLangs = detectLocalizedLanguages(xcDir);
assert(
  ["en", "de", "zh-Hant", "pt"].every((l) => xcLangs.includes(l)),
  "detect languages: .xcstrings parsed",
);

// cleanup
for (const dir of [iosDir, macDir, bothDir, emptyDir, linkDir, itunesDir, noLinkDir, langDir, xcDir]) {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${errors === 0 ? "🎉 All app-store discovery tests passed!" : `❌ ${errors} test(s) failed`}`);
process.exit(errors > 0 ? 1 : 0);
