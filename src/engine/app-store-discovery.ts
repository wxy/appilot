/**
 * Apple product detection + App Store discovery (Phase A step 2).
 *
 * Pure local + free HTTP lookups — no Apple Developer account required:
 * - detectApplePlatform: scan .xcodeproj/.xcworkspace for SDKROOT
 * - discoverAppStoreTrackId: regex the README for an App Store link
 * - lookupApp: resolve trackId → bundleId via the free iTunes Lookup API
 */

import fs from "fs";
import path from "path";
import { log } from "./logger";

export interface AppMetadata {
  trackId: string;
  trackName: string;
  bundleId: string;
  kind: string;
  version: string;
  averageUserRating: number;
  userRatingCount: number;
  primaryGenreName: string;
  artworkUrl: string;
}

export interface AppStoreLink {
  country: string | null;
  trackId: string;
  mt: string | null;
  url: string;
}

export interface AppStoreDiscovery {
  trackId: string;
  links: AppStoreLink[];
}

export interface LocalizedStoreLink {
  country: string;
  name: string;
  platform: "ios" | "macos" | "unknown";
  url: string;
}

/**
 * Localized display names for App Store storefronts.
 */
const STOREFRONT_NAMES: Record<string, string> = {
  us: "美国",
  gb: "英国",
  au: "澳大利亚",
  ca: "加拿大",
  nz: "新西兰",
  ie: "爱尔兰",
  sg: "新加坡",
  za: "南非",
  in: "印度",
  ph: "菲律宾",
  cn: "中国大陆",
  tw: "台湾",
  hk: "香港",
  mo: "澳门",
  jp: "日本",
  kr: "韩国",
  de: "德国",
  at: "奥地利",
  ch: "瑞士",
  fr: "法国",
  es: "西班牙",
  mx: "墨西哥",
  ar: "阿根廷",
  it: "意大利",
  nl: "荷兰",
  br: "巴西",
  pt: "葡萄牙",
  ru: "俄罗斯",
};

const LANGUAGE_NAMES: Record<string, string> = {
  en: "英文",
  "zh-Hans": "简体中文",
  "zh-Hant": "繁体中文",
  ja: "日文",
  ko: "韩文",
  de: "德文",
  fr: "法文",
  es: "西班牙文",
  it: "意大利文",
  nl: "荷兰文",
  pt: "葡萄牙文",
  ru: "俄文",
};

/** Human-readable name for a normalized language code. */
export function languageDisplayName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code;
}

/** Map discovered store links to localized storefronts (one per platform). */
export function localizedStoreLinks(links: AppStoreLink[]): LocalizedStoreLink[] {
  const seen = new Set<string>();
  const result: LocalizedStoreLink[] = [];

  for (const link of links) {
    if (!link.country) continue;
    const country = link.country.toLowerCase();
    const name = STOREFRONT_NAMES[country];
    if (!name) continue;
    if (seen.has(link.url)) continue;
    seen.add(link.url);
    result.push({
      country,
      name,
      platform: link.mt === "12" ? "macos" : link.mt === "8" ? "ios" : "unknown",
      url: link.url,
    });
  }

  return result;
}

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "Pods",
  "build",
  "DerivedData",
  "Carthage",
  ".build",
]);

function findFiles(root: string, filename: string, maxDepth: number, depth = 0): string[] {
  const results: string[] = [];
  if (depth > maxDepth) return results;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      results.push(...findFiles(path.join(root, entry.name), filename, maxDepth, depth + 1));
    } else if (entry.name === filename) {
      results.push(path.join(root, entry.name));
    }
  }
  return results;
}

/** Recursively find files whose name ends with a given suffix. */
function findFilesBySuffix(root: string, suffix: string, maxDepth: number, depth = 0): string[] {
  const results: string[] = [];
  if (depth > maxDepth) return results;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      results.push(...findFilesBySuffix(path.join(root, entry.name), suffix, maxDepth, depth + 1));
    } else if (entry.name.endsWith(suffix)) {
      results.push(path.join(root, entry.name));
    }
  }
  return results;
}

/** Recursively find directories whose name ends with a given suffix. */
function findDirs(root: string, suffix: string, maxDepth: number, depth = 0): string[] {
  const results: string[] = [];
  if (depth > maxDepth) return results;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(root, entry.name);
    if (entry.name.endsWith(suffix)) results.push(full);
    results.push(...findDirs(full, suffix, maxDepth, depth + 1));
  }
  return results;
}

function extractPlistArray(content: string, key: string): string[] {
  const re = new RegExp(`<key>${key}</key>\\s*<array>([\\s\\S]*?)</array>`);
  const match = content.match(re);
  if (!match) return [];
  const strings = match[1].match(/<string>([\s\S]*?)<\/string>/g) || [];
  return strings.map((s) => s.replace(/<\/?string>/g, "").trim()).filter(Boolean);
}

function extractPlistString(content: string, key: string): string | null {
  const re = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`);
  const match = content.match(re);
  return match ? match[1].trim() : null;
}

/** Normalize .lproj / plist language codes to a small canonical set. */
function normalizeLanguage(code: string): string | null {
  const c = code.trim();
  if (!c || c.toLowerCase() === "base") return null;
  const lower = c.toLowerCase();
  if (lower === "english") return "en";
  if (lower.startsWith("zh-hans") || ["zh_cn", "zh-cn", "chs"].includes(lower)) return "zh-Hans";
  if (lower.startsWith("zh-hant") || ["zh_tw", "zh-tw", "zh-hk", "zh-mo", "cht"].includes(lower)) return "zh-Hant";
  const base = lower.split(/[-_]/)[0];
  return base || null;
}

/** Read supported languages from a SwiftUI String Catalog (*.xcstrings). */
function detectLanguagesFromXcstrings(filePath: string): string[] {
  let data: any;
  try {
    data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return [];
  }

  const languages: string[] = [];
  if (data.sourceLanguage) {
    const lang = normalizeLanguage(String(data.sourceLanguage));
    if (lang && !languages.includes(lang)) languages.push(lang);
  }

  const strings = data.strings;
  if (strings && typeof strings === "object") {
    for (const key of Object.keys(strings)) {
      const localizations = strings[key]?.localizations;
      if (!localizations || typeof localizations !== "object") continue;
      for (const code of Object.keys(localizations)) {
        const lang = normalizeLanguage(code);
        if (lang && !languages.includes(lang)) languages.push(lang);
      }
    }
  }

  return languages;
}

/**
 * Detect an app's supported languages from localization directories (*.lproj)
 * and Info.plist `CFBundleLocalizations` / `CFBundleDevelopmentRegion`.
 */
export function detectLocalizedLanguages(localPath: string): string[] {
  const languages = new Set<string>();
  let primaryLanguage: string | null = null;

  for (const dir of findDirs(localPath, ".lproj", 5)) {
    const code = path.basename(dir).replace(/\.lproj$/, "");
    const lang = normalizeLanguage(code);
    if (lang) languages.add(lang);
  }

  for (const xcstrings of findFilesBySuffix(localPath, ".xcstrings", 5)) {
    const xcLanguages = detectLanguagesFromXcstrings(xcstrings);
    if (!primaryLanguage && xcLanguages[0]) {
      primaryLanguage = xcLanguages[0];
    }
    for (const lang of xcLanguages) {
      languages.add(lang);
    }
  }

  for (const plist of findFiles(localPath, "Info.plist", 5)) {
    let content = "";
    try {
      content = fs.readFileSync(plist, "utf-8");
    } catch {
      continue;
    }
    for (const raw of extractPlistArray(content, "CFBundleLocalizations")) {
      const lang = normalizeLanguage(raw);
      if (lang) languages.add(lang);
    }
    const dev = extractPlistString(content, "CFBundleDevelopmentRegion");
    if (dev) {
      const lang = normalizeLanguage(dev);
      if (lang) languages.add(lang);
    }
  }

  const sorted = [...languages].sort();
  if (primaryLanguage) {
    return [primaryLanguage, ...sorted.filter((lang) => lang !== primaryLanguage)];
  }
  return sorted;
}

/** Detect whether a local repo is an iOS or macOS app (macos wins over ios). */
export function detectApplePlatform(localPath: string): "ios" | "macos" | null {
  const pbxprojs = findFiles(localPath, "project.pbxproj", 4);
  let hasIphone = false;
  let hasMac = false;

  for (const file of pbxprojs) {
    let content: string;
    try {
      content = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    if (/SDKROOT\s*=\s*iphoneos/.test(content)) hasIphone = true;
    if (/SDKROOT\s*=\s*macosx/.test(content)) hasMac = true;
  }

  if (hasMac) return "macos";
  if (hasIphone) return "ios";
  return null;
}

const README_CANDIDATES = ["README.md", "readme.md", "Readme.md", "README.markdown"];

function readReadme(localPath: string): string | null {
  const readmePath = README_CANDIDATES.map((name) => path.join(localPath, name))
    .find((p) => fs.existsSync(p));
  if (!readmePath) return null;
  try {
    return fs.readFileSync(readmePath, "utf-8");
  } catch {
    return null;
  }
}

/** Read the full README content for display ("" when missing). */
export function readFullReadme(localPath: string): string {
  return readReadme(localPath) || "";
}

/** Extract every App Store link from README Markdown content. */
export function extractAppStoreLinks(content: string): AppStoreLink[] {
  const links: AppStoreLink[] = [];

  // Modern format: apps.apple.com/{country}/app/{slug}/id{id}?mt={mt}
  const modern = /https?:\/\/[^\s"'<>()]*apple\.com\/([a-z]{2})\/[^\s"'<>()]*?id(\d{6,})(?:\?[^\s"'<>()]*?mt=(\d+))?/gi;
  let m: RegExpExecArray | null;
  while ((m = modern.exec(content)) !== null) {
    links.push({
      country: m[1].toLowerCase(),
      trackId: m[2],
      mt: m[3] ?? null,
      url: m[0],
    });
  }

  // Legacy format without a country: itunes.apple.com/app/id{id}
  const legacy = /https?:\/\/[^\s"'<>()]*apple\.com\/app\/id(\d{6,})/gi;
  while ((m = legacy.exec(content)) !== null) {
    links.push({ country: null, trackId: m[1], mt: null, url: m[0] });
  }

  return links;
}

/** Find App Store links in the README. Prefers the macOS listing (mt=12). */
export function discoverAppStoreLinks(localPath: string): AppStoreDiscovery | null {
  const content = readReadme(localPath);
  if (!content) return null;
  const links = extractAppStoreLinks(content);
  if (links.length === 0) return null;
  const preferred = links.find((l) => l.mt === "12") ?? links[0];
  return { trackId: preferred.trackId, links };
}

/** Backward-compatible single-link helper used by tests and older callers. */
export function discoverAppStoreTrackId(
  localPath: string,
): { trackId: string; mt: string | null } | null {
  const discovery = discoverAppStoreLinks(localPath);
  if (!discovery) return null;
  const preferred = discovery.links.find((l) => l.mt === "12") ?? discovery.links[0];
  return { trackId: discovery.trackId, mt: preferred.mt };
}

/** Resolve a trackId to app metadata via the free iTunes Lookup API. */
export async function lookupApp(trackId: string): Promise<AppMetadata | null> {
  try {
    const res = await fetch(`https://itunes.apple.com/lookup?id=${trackId}`);
    if (!res.ok) return null;
    const data: any = await res.json();
    const r = data?.results?.[0];
    if (!r) return null;
    return {
      trackId: String(r.trackId ?? trackId),
      trackName: r.trackName ?? "",
      bundleId: r.bundleId ?? "",
      kind: r.kind ?? "",
      version: r.version ?? "",
      averageUserRating: r.averageUserRating ?? 0,
      userRatingCount: r.userRatingCount ?? 0,
      primaryGenreName: r.primaryGenreName ?? "",
      artworkUrl: r.artworkUrl512 ?? r.artworkUrl100 ?? r.artworkUrl60 ?? "",
    };
  } catch (err: any) {
    log.warn(`App Store lookup failed for ${trackId}: ${err.message}`);
    return null;
  }
}

/**
 * Read the *current live* version of a store product via the public iTunes
 * Lookup API — the no-ASC-credential fallback for version status.
 *
 * It can only confirm "this exact version is live right now"; it cannot tell
 * whether a non-current version was submitted, is in review, or was rejected.
 * Returns null on any failure (caller shows "未确认").
 */
export async function fetchStoreCurrentVersion(
  trackId: string,
  country = "us",
): Promise<{ version: string; currentVersionReleaseDate: string | null } | null> {
  try {
    const res = await fetch(
      `https://itunes.apple.com/lookup?id=${encodeURIComponent(trackId)}&country=${encodeURIComponent(country)}`,
    );
    if (!res.ok) return null;
    const data: any = await res.json();
    const r = Array.isArray(data?.results) ? data.results[0] : null;
    if (!r) return null;
    return {
      version: typeof r.version === "string" ? r.version : "",
      currentVersionReleaseDate:
        typeof r.currentVersionReleaseDate === "string"
          ? r.currentVersionReleaseDate
          : null,
    };
  } catch (err: any) {
    log.warn(`Store current-version lookup failed for ${trackId}: ${err.message}`);
    return null;
  }
}

/**
 * Per-storefront public copy via iTunes lookup (no credentials needed):
 * localized description + release notes for the given country. Used for the
 * partial freeze when ASC credentials are absent.
 */
export async function fetchStoreLocalizedCopy(
  trackId: string,
  country = "us",
): Promise<{ version: string; description: string; releaseNotes: string } | null> {
  try {
    const res = await fetch(
      `https://itunes.apple.com/lookup?id=${encodeURIComponent(trackId)}&country=${encodeURIComponent(country)}`,
    );
    if (!res.ok) return null;
    const data: any = await res.json();
    const r = Array.isArray(data?.results) ? data.results[0] : null;
    if (!r) return null;
    return {
      version: typeof r.version === "string" ? r.version : "",
      description: typeof r.description === "string" ? r.description : "",
      releaseNotes: typeof r.releaseNotes === "string" ? r.releaseNotes : "",
    };
  } catch (err: any) {
    log.warn(`Store localized copy lookup failed for ${trackId}/${country}: ${err.message}`);
    return null;
  }
}

/** Extract a rough one-paragraph description from the repo README. */
export function readRepoDescription(localPath: string): string {
  const content = readReadme(localPath);
  if (!content) return "";

  const parts: string[] = [];
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    // Skip headings, badges, images, tables, code fences, and list items.
    if (/^#/.test(line)) continue;
    if (/^\[?!?\[/.test(line)) continue;
    if (/^</.test(line)) continue;
    if (/^\|/.test(line)) continue;
    if (/^```/.test(line)) continue;
    if (/^[-*]\s/.test(line)) continue;
    parts.push(line);
    if (parts.join(" ").length > 400) break;
  }
  return parts.join(" ").slice(0, 500);
}
