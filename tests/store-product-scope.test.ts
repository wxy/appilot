import assert from "node:assert/strict";
import {
  copyGapKeywordsForProduct,
  releaseCursorForProduct,
  storeSubmissionDraftsForProduct,
  submissionKeywordsForProduct,
} from "../src/main/project-state";
import { canUsePublicStoreVersion, latestScopedAscSnapshot } from "../src/main/store-product-scope";

const ios = { id: "app:ios", platform: "ios", trackId: 123, submissionKeywords: [{ language: "en", text: "phone" }] };
const mac = { id: "app:macos", platform: "macos", trackId: 123, submissionKeywords: [{ language: "en", text: "desktop" }] };
const project = {
  storeProducts: [ios, mac],
  submissionKeywords: ios.submissionKeywords,
  storeSubmissionDrafts: [
    { productId: ios.id, appVersion: "2.0.0" },
    { productId: mac.id, appVersion: "1.9.0" },
  ],
  copyGapKeywords: [
    { productId: ios.id, language: "en", keyword: "phone" },
    { productId: mac.id, language: "en", keyword: "desktop" },
    { language: "en", keyword: "legacy ambiguous" },
  ],
};

assert.equal(storeSubmissionDraftsForProduct(project, ios.id).length, 1);
assert.equal(storeSubmissionDraftsForProduct(project, ios.id)[0].appVersion, "2.0.0");
assert.equal(submissionKeywordsForProduct(project, mac)[0].text, "desktop");
assert.deepEqual(copyGapKeywordsForProduct(project, mac).map((item) => item.keyword), ["desktop"]);
assert.equal(canUsePublicStoreVersion(project, ios), false, "shared Track ID cannot prove a platform version");
assert.equal(latestScopedAscSnapshot(project, ios, { versions: [{ versionString: "2.0.0" }] }), null);
assert.equal(latestScopedAscSnapshot(project, mac, { platform: "IOS" }), null);
assert.equal(latestScopedAscSnapshot(project, mac, { platform: "MAC_OS", versions: [] })?.platform, "MAC_OS");

const withConfirmedCopy = {
  ...project,
  lastReleaseSha: "project-wide-cursor",
  storeSubmissionDrafts: [
    { productId: ios.id, batchConfirmedAt: "2026-09-01", releaseCommitSha: "ios-cursor" },
    { productId: mac.id, batchConfirmedAt: "2026-09-02", releaseCommitSha: "mac-cursor" },
  ],
};
assert.equal(releaseCursorForProduct(withConfirmedCopy, ios.id), "ios-cursor");
assert.equal(releaseCursorForProduct(withConfirmedCopy, mac.id), "mac-cursor");
assert.equal(releaseCursorForProduct({ ...withConfirmedCopy, storeSubmissionDrafts: [withConfirmedCopy.storeSubmissionDrafts[0]] }, mac.id), null);

console.log("store product scope tests passed ✓");
