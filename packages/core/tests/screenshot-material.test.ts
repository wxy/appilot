import assert from "node:assert";
import {
  generateScreenshotMaterialMaster,
  normalizeScreenshotCopySet,
  normalizeScreenshotMaterialDraft,
  screenshotImageForLanguage,
  screenshotMaterialsForProduct,
  translateScreenshotMaterialMaster,
  upsertScreenshotMaterials,
} from "../src/screenshot-material";
import type { AIProvider } from "../src/ai/ai-provider";

async function main() {
  const normalized = normalizeScreenshotMaterialDraft(
    {
      selectedLanguages: ["en", "xx", "en"],
      sourceLanguage: "en",
      items: [
        {
          id: "home",
          name: "首页",
          copies: {
            en: { title: "See the path", description: "Follow your light." },
            xx: { title: "drop", description: "drop" },
          },
        },
      ],
    },
    "project-1",
    "product-1",
    ["en", "zh-Hans"],
  );
  assert.deepEqual(normalized.selectedLanguages, ["en"]);
  assert.equal(normalized.sourceLanguage, "en");
  assert.equal(normalized.items[0].copies.xx, undefined);

  const withImages = normalizeScreenshotMaterialDraft(
    {
      sourceLanguage: "en",
      selectedLanguages: ["en", "zh-Hans"],
      items: [{
        id: "home",
        name: "首页",
        copies: {},
        sourceImage: { path: "/tmp/home-en.png", fileName: "home-en.png", width: 750, height: 1334, selectedAt: "2026-09-13T01:00:00.000Z" },
        imageOverrides: {
          en: { path: "/tmp/invalid-source-override.png", fileName: "invalid.png", width: 1, height: 1, selectedAt: "2026-09-13T01:00:00.000Z" },
          "zh-Hans": { path: "/tmp/home-zh.png", fileName: "home-zh.png", width: 750, height: 1334, selectedAt: "2026-09-13T01:00:00.000Z" },
          xx: { path: "/tmp/drop.png", fileName: "drop.png", width: 1, height: 1, selectedAt: "2026-09-13T01:00:00.000Z" },
        },
      }],
    },
    "project-1",
    "product-1",
    ["en", "zh-Hans"],
  );
  assert.equal(screenshotImageForLanguage(withImages.items[0], "en", "en")?.path, "/tmp/home-en.png");
  assert.equal(screenshotImageForLanguage(withImages.items[0], "zh-Hans", "en")?.path, "/tmp/home-zh.png");
  assert.equal(withImages.items[0].imageOverrides?.en, undefined, "the source language never stores an override");
  assert.equal(withImages.items[0].imageOverrides?.xx, undefined, "unsupported language images are dropped");
  delete withImages.items[0].imageOverrides?.["zh-Hans"];
  assert.equal(
    screenshotImageForLanguage(withImages.items[0], "zh-Hans", "en")?.path,
    "/tmp/home-en.png",
    "a target language inherits the source image when no override exists",
  );

  const typeOnly = normalizeScreenshotMaterialDraft(
    { selectedLanguages: ["en"], items: [{ id: "settings", name: "设置页", copies: {} }] },
    "project-1",
    "product-1",
    ["en"],
  );
  assert.equal(typeOnly.items[0].name, "设置页", "a screenshot type does not require an image before generation");

  const singleLine = normalizeScreenshotMaterialDraft(
    {
      selectedLanguages: ["en"],
      items: [{ id: "home", name: "首页", copies: { en: { title: "Walk\nbright", description: "One line\nonly" } } }],
    },
    "project-1",
    "product-1",
    ["en"],
  );
  assert.equal(singleLine.items[0].copies.en.title, "Walk bright", "screenshot title is normalized to one line");
  assert.equal(singleLine.items[0].copies.en.description, "One line only", "screenshot description is normalized to one line");

  const embedded = normalizeScreenshotCopySet(
    { ...normalized, masterConfirmedAt: "2026-09-12T01:00:00.000Z" },
    "zh-Hans",
    ["en", "zh-Hans"],
  );
  assert.equal(embedded.sourceLanguage, "zh-Hans", "screenshot copy keeps an independent source language");
  assert.deepEqual(embedded.selectedLanguages, ["zh-Hans", "en"], "screenshot copy keeps an independent language range");
  assert.equal(embedded.masterConfirmedAt, undefined, "changing the fixed master language resets confirmation");
  assert.equal(embedded.items[0].copies.en.title, "See the path", "legacy copy survives embedding");

  const confirmedEmbedded = normalizeScreenshotCopySet(
    { ...normalized, masterConfirmedAt: "2026-09-12T01:00:00.000Z" },
    "en",
    ["en", "zh-Hans"],
  );
  assert.equal(confirmedEmbedded.masterConfirmedAt, "2026-09-12T01:00:00.000Z", "confirmation survives when the independent master language is unchanged");

  const withTemplate = normalizeScreenshotCopySet(
    { ...normalized, keynoteTemplatePath: " /tmp/screenshots.key " },
    "en",
    ["en", "zh-Hans"],
  );
  assert.equal(withTemplate.keynoteTemplatePath, "/tmp/screenshots.key", "the selected Keynote template is persisted with the copy set");

  const migratedEmbedded = normalizeScreenshotCopySet(
    { sourceLanguage: "zh-Hans", items: [], masterUpdatedAt: "", updatedAt: "" },
    "zh-Hans",
    ["en", "zh-Hans", "ja"],
  );
  assert.deepEqual(
    migratedEmbedded.selectedLanguages,
    ["zh-Hans", "en", "ja"],
    "embedded legacy copy without a language field inherits every supported language",
  );
  const explicitSingleLanguage = normalizeScreenshotCopySet(
    { sourceLanguage: "zh-Hans", selectedLanguages: ["zh-Hans"], items: [], masterUpdatedAt: "", updatedAt: "" },
    "zh-Hans",
    ["en", "zh-Hans", "ja"],
  );
  assert.deepEqual(explicitSingleLanguage.selectedLanguages, ["zh-Hans"], "an explicit single-language selection is preserved");

  const project: { screenshotMaterials?: unknown[] } = {};
  upsertScreenshotMaterials(project, normalized);
  assert.equal(screenshotMaterialsForProduct(project, "product-1")?.items.length, 1);
  upsertScreenshotMaterials(project, { ...normalized, items: [] });
  assert.equal(project.screenshotMaterials?.length, 1, "same product is replaced, not duplicated");

  const provider = {
    chat: async () => JSON.stringify({
      screenshots: [
        { id: "home", title: "Walk into the light", description: "See every step become a path." },
        { id: "hud", title: "Stay in the moment", description: "Keep your walk essentials in view." },
      ],
    }),
  } as unknown as AIProvider;
  const generated = await generateScreenshotMaterialMaster(provider, {
    productName: "GloWalk",
    language: "en",
    screenshots: [
      { id: "home", name: "首页" },
      { id: "hud", name: "HUD 页面" },
    ],
  });
  assert.equal(generated.home.title, "Walk into the light");

  const translationProvider = {
    chat: async () => JSON.stringify({
      screenshots: [
        { id: "home", title: "循光而行", description: "让每一步汇成清晰的足迹。" },
        { id: "hud", title: "专注当下", description: "步行信息始终清晰可见。" },
      ],
    }),
  } as unknown as AIProvider;
  const translated = await translateScreenshotMaterialMaster(translationProvider, {
    productName: "GloWalk",
    sourceLanguage: "en",
    targetLanguages: ["zh-Hans"],
    screenshots: [
      { id: "home", name: "首页" },
      { id: "hud", name: "HUD 页面" },
    ],
    source: generated,
  });
  assert.equal(translated["zh-Hans"].hud.description, "步行信息始终清晰可见。");

  await assert.rejects(
    () => generateScreenshotMaterialMaster(provider, {
      productName: "GloWalk",
      language: "",
      screenshots: [{ id: "home", name: "首页" }],
    }),
    /选择母本语言/,
  );
  console.log("All screenshot material tests passed ✅");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
