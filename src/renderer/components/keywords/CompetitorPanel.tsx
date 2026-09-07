import { useCallback, useEffect, useState } from "react";
import { storefrontDisplayName, storefrontsForLanguage } from "@appilot-labs/appilot-core/storefronts";
import { platformLabel } from "../../lib/format";
import { cn } from "../../lib/utils";
import { btnPrimary, btnSmPrimary, btnSmSecondary } from "../ui/styles";

// —— 竞品矩阵（纯计算辅助，模块级）——
// 语言标签：矩阵列组头 + 商店级展开的词列 tooltip。
const FACE_LANG_LABEL: Record<string, string> = {
  en: "英语",
  "zh-Hans": "简体中文",
  "zh-Hant": "繁体中文",
  ja: "日语",
  ko: "韩语",
  de: "德语",
  fr: "法语",
  es: "西班牙语",
  pt: "葡萄牙语",
  ru: "俄语",
};
const LANG_PRIORITY = ["en", "zh-Hans", "zh-Hant", "ja", "ko", "de", "fr", "es", "it", "nl", "pt", "pt-BR", "ru"];
function langRank(code: string): number {
  const i = LANG_PRIORITY.indexOf(code);
  return i === -1 ? LANG_PRIORITY.length : i;
}
// 英语地区（组「英语」）与组「全局」的商店口径。
const EN_REGION_STORES = storefrontsForLanguage("en"); // us/gb/au/ca/nz/ie
const GROUP_EN_TITLE = `英语地区商店 ${EN_REGION_STORES.join("/")} 的跨店综合`;
const GROUP_GLOBAL_TITLE = `该 en 词在其它语言商店（非 ${EN_REGION_STORES.join("/")}，如 kr/jp/de）的跨店综合`;

// —— 矩阵列组（列 = 关键词，按“语言/区域组”分组）——
// 分组集合 = 各本地化语言（zh-Hans/ja/ko…）+ 两个特殊大组：组「英语」与组「全局」
// （全局视为一种“语言”组）。非英语词只在其语言组出现一次；en 词按商店区域拆两组：
// 组「英语」= 该 en 词在英语地区商店（us/gb/au/ca/nz/ie）的跨店综合，组「全局」=
// 该 en 词在其它语言商店（kr/jp/de…）的跨店综合 —— 同一 en 词可在两组各占一列
// （语义上为不同维度）。组序固定：本地化语言（按 LANG_PRIORITY）→ 英语 → 全局；
// 组内关键词按“组内被多少竞品命中”降序；该组无数据（无商店快照）的词不生成列。
interface MatrixGroup {
  id: string; // `lang:${code}` / "en-region" / "en-global"（唯一）
  lang: string; // 该组底层语言（英语/全局组都是 "en"）
  label: string; // 组头文本（简体中文 / 英语 / 全局…）
  title: string; // 组头 tooltip（覆盖的商店口径）
  rank: number; // 组序：语言组 = langRank；英语/全局组固定排在所有语言组之后
  inGroup: (storefront: string) => boolean; // 该组覆盖商店的判定（与 face.cells 求交）
}
interface MatrixCol {
  key: string; // `${group.id}\u0000${keyword}`（唯一）
  group: MatrixGroup;
  lang: string; // 词的语言（聚焦词按语言精确过滤；en 词为 "en"）
  keyword: string;
  hit: number; // 该组内命中该词的竞品数（组内排序用）
}
const MAX_MATRIX_COLS = 40;
// 本地化语言组（en 词不进语言组；未知语言 fallback code 并排在已知语言之后）。
function localLangGroup(code: string): MatrixGroup {
  const label = FACE_LANG_LABEL[code] || code;
  const stores = storefrontsForLanguage(code);
  return {
    id: `lang:${code}`,
    lang: code,
    label,
    title: `该词在${label}商店（${stores.join("/")}）的跨店综合`,
    rank: langRank(code),
    inGroup: (sf: string) => stores.includes(sf),
  };
}
const EN_REGION_GROUP: MatrixGroup = {
  id: "en-region",
  lang: "en",
  label: "英语",
  title: GROUP_EN_TITLE,
  rank: LANG_PRIORITY.length + 1,
  inGroup: (sf: string) => EN_REGION_STORES.includes(sf),
};
const EN_GLOBAL_GROUP: MatrixGroup = {
  id: "en-global",
  lang: "en",
  label: "全局",
  title: GROUP_GLOBAL_TITLE,
  rank: LANG_PRIORITY.length + 2,
  inGroup: (sf: string) => !EN_REGION_STORES.includes(sf),
};
// 组间按 rank（语言组 → 英语 → 全局）；rank 并列（未知语言组）时按组 id 稳定排序，
// 保证同组关键词连续不交错；组内按命中竞品数降序、词序兜底。
function compareCols(a: MatrixCol, b: MatrixCol): number {
  if (a.group.rank !== b.group.rank) return a.group.rank - b.group.rank;
  if (a.group.id !== b.group.id) return a.group.id < b.group.id ? -1 : 1;
  return b.hit - a.hit || a.keyword.localeCompare(b.keyword);
}

// 从 profiles（competitors:overview → {competitor, intel, indexHistory}）收集矩阵列：
// 词按语言归组；en 词按商店区域拆「英语」「全局」两个候选列，各自有数据（组商店集内
// 有排名快照）才生成，避免空列。聚焦词时只保留该词所在的组列，否则最多 MAX_MATRIX_COLS 列。
function computeMatrixCols(profiles: any[], focusWord: string, focusLang: string): MatrixCol[] {
  const hasRank = (cell: any) => typeof cell?.own === "number" || typeof cell?.theirs === "number";
  const colsByKey = new Map<string, MatrixCol>();
  const touch = (group: MatrixGroup, f: any) => {
    const key = `${group.id}\u0000${f.keyword}`;
    let col = colsByKey.get(key);
    if (!col) {
      col = { key, group, lang: String(f.language ?? "en"), keyword: f.keyword, hit: 0 };
      colsByKey.set(key, col);
    }
    col.hit += 1; // 一个竞品对该 (组 × 词) 至多计一次
  };
  for (const p of profiles || []) {
    for (const f of p?.intel?.faces || []) {
      if (!Array.isArray(f?.cells) || f.cells.length === 0) continue;
      const keyword = f.keyword;
      if (typeof keyword !== "string" || keyword.length === 0) continue;
      const cells: any[] = f.cells.filter(hasRank);
      if (cells.length === 0) continue; // 无排名快照 → 不生成列
      if (String(f.language ?? "en") === "en") {
        if (cells.some((c) => EN_REGION_GROUP.inGroup(c.storefront))) touch(EN_REGION_GROUP, f);
        if (cells.some((c) => EN_GLOBAL_GROUP.inGroup(c.storefront))) touch(EN_GLOBAL_GROUP, f);
      } else {
        const group = localLangGroup(String(f.language));
        if (cells.some((c) => group.inGroup(c.storefront))) touch(group, f);
      }
    }
  }
  const all = [...colsByKey.values()];
  if (focusWord) {
    const exact = all.filter((c) => c.keyword === focusWord && c.lang === focusLang);
    const loose = all.filter((c) => c.keyword === focusWord);
    return (exact.length > 0 ? exact : loose).sort(compareCols);
  }
  return all.sort(compareCols).slice(0, MAX_MATRIX_COLS);
}

interface CellAgg {
  myLead: number; // 我方领先商店数（它未上榜我在榜 / 双方在榜且我名次更好）
  theirLead: number;
  myBest: number | null;
  theirBest: number | null;
  myStores: string[];
  theirStores: string[];
}
// 对 (竞品 × 词 × 段) 的商店集做跨店综合：cells = [{storefront, own, theirs}]，
// own/theirs 为各自最好名次；own < theirs → 我领先，反之它领先，名次并列不计。
function aggregateCells(cells: any[], stores?: string[]): CellAgg {
  const agg: CellAgg = { myLead: 0, theirLead: 0, myBest: null, theirBest: null, myStores: [], theirStores: [] };
  for (const c of cells || []) {
    if (stores && !stores.includes(c?.storefront)) continue;
    const own = typeof c?.own === "number" ? (c.own as number) : null;
    const theirs = typeof c?.theirs === "number" ? (c.theirs as number) : null;
    if (own != null && (agg.myBest == null || own < agg.myBest)) agg.myBest = own;
    if (theirs != null && (agg.theirBest == null || theirs < agg.theirBest)) agg.theirBest = theirs;
    if (own != null && theirs == null) {
      agg.myLead += 1;
      agg.myStores.push(c.storefront);
    } else if (theirs != null && own == null) {
      agg.theirLead += 1;
      agg.theirStores.push(c.storefront);
    } else if (own != null && theirs != null) {
      if (own < theirs) {
        agg.myLead += 1;
        agg.myStores.push(c.storefront);
      } else if (theirs < own) {
        agg.theirLead += 1;
        agg.theirStores.push(c.storefront);
      }
    }
  }
  return agg;
}

const TONE_GREY = "bg-zinc-100/70 dark:bg-zinc-800/50 text-zinc-400 dark:text-zinc-500";
const TONE_MY = "bg-emerald-500/15 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300";
const TONE_THEIR = "bg-red-500/15 dark:bg-red-500/20 text-red-700 dark:text-red-300";
const TONE_TIED = "bg-amber-400/20 dark:bg-amber-400/25 text-amber-700 dark:text-amber-300";
const TONE_FLAT = "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400";
// 格/段芯片配色：myLead > theirLead 绿（我方占优）· theirLead > myLead 红（竞品占优）
// · 并列且 >0 琥珀（胶着）· 无数据灰 · 0:0 中性。
function leadTone(myLead: number, theirLead: number, hasData: boolean): { cls: string; text: string } {
  if (!hasData) return { cls: TONE_GREY, text: "—" };
  if (myLead > theirLead) return { cls: TONE_MY, text: `${myLead} : ${theirLead}` };
  if (theirLead > myLead) return { cls: TONE_THEIR, text: `${myLead} : ${theirLead}` };
  if (myLead + theirLead > 0) return { cls: TONE_TIED, text: `${myLead} : ${theirLead}` };
  return { cls: TONE_FLAT, text: "0 : 0" };
}
// 明细 title（矩阵格共用）：我最好 #x / 它最好 #y · 我领先商店 a,b / 它领先 c,d。
// label 传入列组名（简体中文 / 英语 / 全局）。
function segDetailTitle(keyword: string, label: string, agg: CellAgg): string {
  const parts: string[] = [`我最好 #${agg.myBest ?? "—"}`, `它最好 #${agg.theirBest ?? "—"}`];
  if (agg.myStores.length > 0) parts.push(`我领先：${agg.myStores.map(storefrontDisplayName).join("、")}`);
  if (agg.theirStores.length > 0) parts.push(`它领先：${agg.theirStores.map(storefrontDisplayName).join("、")}`);
  if (agg.myStores.length === 0 && agg.theirStores.length === 0) parts.push("名次并列或未上榜，无一方领先");
  return `「${keyword}」${label}：${parts.join(" · ")}`;
}
// —— 行展开（商店级）：格态与词列序辅助 ——
// (词 × 商店) 格：只认“名次 ≤200”的入榜数据；双方都无在榜数据返回 null（格留白）。
// 返回三态配色与“它 #x · 我 #y”合并文案（不在榜的一侧省略）：
// 红 = 它压我（它上榜且更前 / 只有它上榜）· 琥珀 = 重叠(并列在榜) · 绿 = 我方占优（我更前 / 只有我上榜）。
function storeCellTone(ownRaw: unknown, theirsRaw: unknown): { cls: string; text: string } | null {
  const own = typeof ownRaw === "number" && ownRaw > 0 && ownRaw <= 200 ? ownRaw : null;
  const theirs = typeof theirsRaw === "number" && theirsRaw > 0 && theirsRaw <= 200 ? theirsRaw : null;
  if (own == null && theirs == null) return null;
  let cls: string;
  if (theirs != null && (own == null || theirs < own)) cls = TONE_THEIR; // 压我
  else if (theirs != null && own != null && own === theirs) cls = TONE_TIED; // 重叠(并列在榜)
  else cls = TONE_MY; // 我方占优
  const text = [theirs != null ? `它 #${theirs}` : "", own != null ? `我 #${own}` : ""]
    .filter(Boolean)
    .join(" · ");
  return { cls, text };
}
// 商店级展开的词列组序：本地化语言（按 LANG_PRIORITY）在前，en 词排最后——与矩阵列序一致
// （矩阵里 en 词落在「英语」「全局」两个尾组，本地化语言组在前）。
function faceLangRank(lang: unknown): number {
  const code = String(lang ?? "en");
  if (code === "en") return LANG_PRIORITY.length + 1;
  return langRank(code);
}

export function CompetitorPanel({
  projectId,
  product,
  defaultTerm,
  viewLang,
  focusKeyword,
}: {
  projectId: string;
  product: {
    id?: string;
    platform?: string;
    supportedLanguages?: { code: string }[];
    trackId?: string | null;
    bundleId?: string | null;
    trackName?: string | null;
  };
  defaultTerm: string;
  viewLang: string;
  /** 旧“竞品跟踪”视图的入参（排名明细现来自 overview 的 intel.faces），保留以兼容调用方。 */
  rankSnapshots: any[];
  /** 旧版译文标注入参（已不再使用），保留以兼容调用方。 */
  projectKeywords?: any[];
  /** 从关键词矩阵钻取进来的词：进入即聚焦“该词 × 全部竞品”对比（可关闭回完整矩阵）。 */
  focusKeyword?: string;
}) {
  const [competitors, setCompetitors] = useState<any[]>([]);
  const [term, setTerm] = useState(defaultTerm);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [addMessage, setAddMessage] = useState("");
  const [refreshingRanks, setRefreshingRanks] = useState(false);
  const [page, setPage] = useState(0);
  const [searchError, setSearchError] = useState("");
  // 竞品总览（competitors:overview → [{competitor, intel, indexHistory}]，intel.faces 即矩阵数据）。
  const [profiles, setProfiles] = useState<any[]>([]);
  // 矩阵行展开（商店级对比：行 = 商店 × 列 = 词）。
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [profilesTick, setProfilesTick] = useState(0);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  // 词钻取聚焦：进入竞品标签时若带词，矩阵只保留该词的列（可关闭回完整矩阵）。
  const [focusCleared, setFocusCleared] = useState(false);
  const wordDrill = focusKeyword && !focusCleared ? focusKeyword : "";
  useEffect(() => {
    if (focusKeyword) {
      setTerm(focusKeyword);
      setFocusCleared(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKeyword, viewLang]);

  const load = useCallback(() => {
    (window as any).appilot?.competitors?.list(projectId)
      .then((list: any[]) => setCompetitors(list || []))
      .catch(() => setCompetitors([]));
  }, [projectId]);
  // 竞品总览：按当前产品（平台）聚合每个竞品的竞争面与竞争指数。
  const loadOverview = useCallback(() => {
    if (!projectId || !product?.id) {
      setProfiles([]);
      return;
    }
    (window as any).appilot?.competitors?.overview(projectId, product.id)
      .then((list: any[]) => setProfiles(list || []))
      .catch(() => setProfiles([]));
  }, [projectId, product?.id]);
  useEffect(() => { loadOverview(); }, [loadOverview, profilesTick]);
  useEffect(() => { load(); }, [load]);
  // 在榜词自动发现扫描（P3：只扫我方在榜词；每日限流，界面提示结果）。
  const handleScanOnChart = async () => {
    if (scanBusy || !product?.id) return;
    setScanBusy(true);
    setScanMsg(null);
    try {
      const res = await (window as any).appilot?.competitors?.scanOnChart(projectId, product.id);
      if (res?.ok) {
        setScanMsg(
          `扫描 ${res.checked} 个在榜词：${res.updatedCompetitors} 个竞品新增交集 ${res.foundKeywords} 处，发现 ${res.newCandidates} 个新候选。`,
        );
      } else if (res?.throttled) {
        setScanMsg("今日已扫描过（每日限流一次），明天再来或需要强制重扫告诉我。");
      } else {
        setScanMsg(res?.error || "扫描失败");
      }
      setProfilesTick((v) => v + 1);
    } catch (err: any) {
      setScanMsg(err?.message || "扫描失败");
    } finally {
      setScanBusy(false);
    }
  };
  // 主进程数据变更推送：竞品数据更新时自动刷新。
  useEffect(() => {
    const handler = (e: Event) => {
      if ((e as CustomEvent).detail === "competitors") load();
    };
    window.addEventListener("appilot:data-changed", handler);
    return () => window.removeEventListener("appilot:data-changed", handler);
  }, [load]);

  // Keep the search box in sync with the keyword selected in the matrix.
  useEffect(() => {
    setTerm(defaultTerm);
  }, [defaultTerm]);

  // A changed search context (language / storefront / keyword) invalidates
  // the previous results.
  useEffect(() => {
    setCandidates([]);
    setSearchError("");
    setPage(0);
  }, [viewLang, defaultTerm]);

  // 按语言搜索：该语言对应的全部商店。
  const countryOptions = viewLang ? storefrontsForLanguage(viewLang) : ["us"];

  const handleSearch = async () => {
    if (!term.trim()) return;
    setSearching(true);
    setSearchError("");
    setAddMessage("");
    setPage(0);
    setCandidates([]);
    try {
      const results = await (window as any).appilot?.competitors?.search({
        term: term.trim(),
        countries: countryOptions,
        platform: product?.platform,
      });
      setCandidates(results || []);
    } catch (err: any) {
      setSearchError(err?.message || "搜索失败，请稍后重试。");
    } finally {
      setSearching(false);
    }
  };

  const handleAdd = async (candidate: any) => {
    setAdding(candidate.trackId);
    try {
      const platform = product?.platform === "macos" ? "macos" : "ios";
      // 关联搜索框里正在搜索的关键词（用户可能搜了别的词），而不是矩阵选中词。
      const keyword = term.trim();
      const language = viewLang || "en";
      // 搜索结果已带各商店排名：随保存立即回填竞品矩阵，不必等下次抓取。
      const seedRanks = Object.entries(candidate.ranks || {})
        .filter(([, rank]) => typeof rank === "number")
        .map(([storefront, rank]) => ({
          keyword,
          language,
          storefront,
          platform,
          rank: rank as number,
        }));
      const res = await (window as any).appilot?.competitors?.save(projectId, {
        name: candidate.trackName,
        trackId: candidate.trackId,
        platform,
        // 按平台写入 trackId：同一品牌可再关联另一平台的列表。
        trackIds: { [platform]: candidate.trackId },
        githubUrl: null,
        notes: "",
        // 关联当前关键词：之后按 (竞品, 关键词, 商店) 采集竞品排名。
        // 关联语言 = 搜索时的视图语言（中文视图 → cn/sg，英文视图 → us/gb 等），
        // 竞品排名按该语言商店采集，与矩阵中该视图看到的排名一致。
        linkedKeywords: keyword
          ? [{ keyword, language }]
          : [],
        seedRanks,
      });
      setAddMessage(
        res?.merged
          ? "该竞品已存在，已自动关联当前平台版本，排名已按搜索结果回填。"
          : "已添加，排名已按搜索结果回填。",
      );
      await load();
      setProfilesTick((v) => v + 1);
    } finally {
      setAdding(null);
    }
  };

  // 当前视图平台：竞品矩阵只看该平台的排名，避免 iOS/macOS 数据混比。
  const viewPlatform: "ios" | "macos" =
    product?.platform === "macos" ? "macos" : "ios";
  const competitorTrackId = (competitor: any, platform: "ios" | "macos"): string | null => {
    const ids = { ...(competitor.trackIds || {}) };
    if (competitor.trackId && competitor.platform === platform) {
      ids[platform] = competitor.trackId;
    }
    return ids[platform] ? String(ids[platform]) : null;
  };

  const appStorePageUrl = (candidate: any) =>
    candidate.trackViewUrl ||
    `https://apps.apple.com/${candidate.country || "us"}/app/id${candidate.trackId}`;

  const handleRemove = async (competitorId: string) => {
    await (window as any).appilot?.competitors?.remove(projectId, competitorId);
    load();
    setProfilesTick((v) => v + 1);
    if (expandedRowId === competitorId) setExpandedRowId(null);
  };

  const handleRefreshRanks = async () => {
    if (refreshingRanks) return;
    setRefreshingRanks(true);
    try {
      await (window as any).appilot?.competitors?.refreshRanks(projectId);
      await load();
      setProfilesTick((v) => v + 1);
    } finally {
      setRefreshingRanks(false);
    }
  };

  // 每个关键词最多关联 10 个竞品。
  const MAX_COMPETITORS_PER_KEYWORD = 10;
  const defaultKeyword = term.trim();
  const defaultLinkedCount = competitors.filter((c: any) =>
    (c.linkedKeywords || []).some(
      (l: any) =>
        l.keyword === defaultKeyword && l.language === (viewLang || "en"),
    ),
  ).length;
  const atLimit = defaultLinkedCount >= MAX_COMPETITORS_PER_KEYWORD;
  const ownTrackId = String(product?.trackId ?? "");
  const hasSelfInResults = candidates.some((c) => String(c.trackId) === ownTrackId);
  // “已添加”按 (竞品, 当前关键词) 判定：同一竞品关联了别的关键词时，
  // 仍可把它再关联到当前关键词（跟踪关系按关键词 × 商店组合）。
  const isAddedCandidate = (candidate: any) =>
    competitors.some((c: any) => {
      const ids = [c.trackId, ...Object.values(c.trackIds || {})]
        .filter(Boolean)
        .map(String);
      return (
        ids.includes(String(candidate.trackId)) &&
        (c.linkedKeywords || []).some(
          (l: any) =>
            l.keyword === term.trim() &&
            l.language === (viewLang || "en"),
        )
      );
    });
  const PAGE_SIZE = 12;
  const totalPages = Math.max(1, Math.ceil(candidates.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageCandidates = candidates.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE,
  );

  // —— 竞品矩阵：行列推导（列按“语言/区域组”分组）——
  const matrixRows: any[] = [...profiles].sort(
    (a: any, b: any) =>
      (b.intel?.index ?? 0) - (a.intel?.index ?? 0) ||
      String(a.competitor?.name ?? "").localeCompare(String(b.competitor?.name ?? "")),
  );
  const matrixCols = computeMatrixCols(matrixRows, wordDrill, viewLang || "en");
  // matrixCols 已按组排序，同组连续：连续同组的列聚成一个组头（colSpan = 组内列数）。
  const colGroups: Array<{ group: MatrixGroup; cols: MatrixCol[] }> = [];
  for (const col of matrixCols) {
    const last = colGroups[colGroups.length - 1];
    if (last && last.group.id === col.group.id) last.cols.push(col);
    else colGroups.push({ group: col.group, cols: [col] });
  }
  const totalCols = matrixCols.length;
  const toggleRow = (competitorId: string) => {
    setExpandedRowId((prev) => (prev === competitorId ? null : competitorId));
  };

  // —— 竞品矩阵渲染辅助 ——
  // (竞品 × 组 × 词) 的跨店综合格：只统计该组覆盖商店集里的领先数。
  const renderCell = (col: MatrixCol, face: any) => {
    const cells = (face?.cells || []).filter((c: any) => col.group.inGroup(c?.storefront));
    const agg = aggregateCells(cells);
    const hasData = agg.myBest != null || agg.theirBest != null;
    if (!hasData) {
      // 该竞品在该 (词 × 组) 没有排名快照：显示空白格（悬停给原因），不刷屏。
      return (
        <td key={col.key} className="p-0.5">
          <span
            title={`「${col.keyword}」${col.group.label}：该竞品未采集此词（无排名快照）`}
            className="block min-h-6 rounded-md"
          />
        </td>
      );
    }
    const tone = leadTone(agg.myLead, agg.theirLead, true);
    const title = segDetailTitle(col.keyword, col.group.label, agg);
    return (
      <td key={col.key} className="p-0.5">
        <span
          title={title}
          className={cn(
            "block min-w-[3.2rem] px-1.5 py-1 rounded-md text-center text-[11px] font-semibold tabular-nums",
            tone.cls,
          )}
        >
          {tone.text}
        </span>
      </td>
    );
  };
  // 行展开（商店级）：把该竞品这一行在“商店层面”展开——行 = 商店、列 = 该竞品的词
  // （复用矩阵的关键词/列概念），格 = 该词在该商店 它/我 的最好名次合并一格，三色表示谁压谁。
  const renderRowDetail = (profile: any) => {
    const intel = profile.intel || {};
    // 词列：该竞品有商店排名数据的词（cells 非空）；排序与矩阵一致——本地化语言组
    // （按 LANG_PRIORITY）在前，en 词排最后（矩阵中 en 词落在「英语」「全局」两个尾组）。
    const words: any[] = [...(intel.faces || [])]
      .filter((f: any) => Array.isArray(f?.cells) && (f.cells as any[]).length > 0)
      .sort(
        (a: any, b: any) =>
          faceLangRank(a?.language) - faceLangRank(b?.language) ||
          String(a?.keyword ?? "").localeCompare(String(b?.keyword ?? "")),
      );
    // 商店集 = union 该竞品全部词列 cells 的 storefront。
    const storeSet = new Set<string>();
    for (const w of words) {
      for (const c of w?.cells || []) {
        if (typeof c?.storefront === "string" && c.storefront.length > 0) storeSet.add(c.storefront);
      }
    }
    // 只保留“至少有一个词在该商店入榜（名次 ≤200）”的商店行；完全没有在榜数据的行不显示。
    const hasOnChartCell = (sf: string) =>
      words.some((w) =>
        (w?.cells || []).some(
          (c: any) =>
            c?.storefront === sf &&
            ((typeof c?.own === "number" && c.own > 0 && c.own <= 200) ||
              (typeof c?.theirs === "number" && c.theirs > 0 && c.theirs <= 200)),
        ),
      );
    const storeRows = [...storeSet]
      .filter(hasOnChartCell)
      .sort((a, b) => {
        // 英语地区商店（矩阵「英语」列组口径：us/gb/au/ca/nz/ie）行在前，其余按代码稳定排。
        const ai = EN_REGION_STORES.indexOf(a);
        const bi = EN_REGION_STORES.indexOf(b);
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return -1;
        if (bi !== -1) return 1;
        return a.localeCompare(b);
      });
    // 空态：该竞品没有任何“在榜”的商店级数据。
    if (storeRows.length === 0) {
      return (
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          暂无商店级在榜数据（先采集或刷新排名）。
        </p>
      );
    }
    return (
      <div className="space-y-1.5">
        {/* 极简图例：三色小方块与格同色（红 = 压我 · 琥珀 = 重叠(并列在榜) · 绿 = 我方占优）。 */}
        <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-zinc-400 dark:text-zinc-500">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-sm bg-red-500/70" />
            它压我
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-sm bg-amber-400/80" />
            重叠(并列在榜)
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-sm bg-emerald-500/70" />
            我方占优
          </span>
        </p>
        <div className="overflow-x-auto rounded-lg border border-zinc-200/80 dark:border-zinc-700/60">
          <table className="border-collapse">
            <thead>
              <tr className="border-b-2 border-zinc-300 dark:border-zinc-600">
                <th
                  className="px-2 py-1.5 text-left whitespace-nowrap text-[10px] font-semibold text-zinc-500 dark:text-zinc-400"
                  title="行 = 商店（只列有在榜数据的店，名次 ≤200 才算在榜）；格 = 该词在该商店 它/我 的最好名次（近 7 天窗口，名次越小越好）"
                >
                  商店
                </th>
                {words.map((w) => {
                  const lang = String(w?.language ?? "en");
                  return (
                    <th
                      key={`${lang}\u0000${w.keyword}`}
                      className="px-1 py-1.5 align-top text-center border-l border-zinc-100 dark:border-zinc-800"
                      style={{ width: "6.5rem", minWidth: "6.5rem", maxWidth: "6.5rem" }}
                      title={`「${w.keyword}」· ${FACE_LANG_LABEL[lang] || lang}`}
                    >
                      <span className="block break-words leading-tight font-mono text-[11px] text-zinc-600 dark:text-zinc-300">
                        {w.keyword}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {storeRows.map((sf) => (
                <tr key={sf} className="border-b border-zinc-100 dark:border-zinc-800 last:border-0">
                  <th scope="row" className="px-2 py-1 text-left align-top whitespace-nowrap font-normal">
                    <span className="text-[11px] text-zinc-600 dark:text-zinc-300">{storefrontDisplayName(sf)}</span>
                    <span className="ml-1.5 font-mono text-[9px] text-zinc-400 dark:text-zinc-500">{sf}</span>
                  </th>
                  {words.map((w) => {
                    const cell = (w?.cells || []).find((c: any) => c?.storefront === sf);
                    const state = storeCellTone(cell?.own, cell?.theirs);
                    return (
                      <td key={`${String(w?.language ?? "en")}\u0000${w.keyword}`} className="p-0.5">
                        {state ? (
                          <span
                            title={`${storefrontDisplayName(sf)} · 「${w.keyword}」：${state.text}`}
                            className={cn(
                              "block rounded-md px-1 py-1 text-center text-[10px] font-medium tabular-nums whitespace-nowrap",
                              state.cls,
                            )}
                          >
                            {state.text}
                          </span>
                        ) : (
                          <span
                            title="该店该词双方都无在榜数据（未采集或名次 >200）"
                            className="block min-h-6 rounded-md"
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">竞品雷达</h3>
        <span className="text-[11px] text-zinc-400 dark:text-zinc-500">手动添加 + 从关键词搜索候选一键加入，每日自动快照</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="搜索竞品（默认当前关键词）"
          className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm px-2.5 py-1.5 w-56"
        />
        <button type="button" onClick={() => void handleSearch()} disabled={searching} className={btnPrimary}>
          {searching ? "搜索中…" : "搜索候选"}
        </button>
      </div>

      {searchError && (
        <p className="mb-4 text-xs text-red-600 dark:text-red-400">{searchError}</p>
      )}
      {addMessage && (
        <p className="mb-4 text-xs text-amber-600 dark:text-amber-400">{addMessage}</p>
      )}

      {candidates.length > 0 && (
        <>
        {!hasSelfInResults && (
          <p className="mb-2 text-[11px] text-zinc-400 dark:text-zinc-500">
            当前平台（{platformLabel(product?.platform || "unknown")}）的搜索结果中未包含本应用
            ——你可能在 iOS 商店排名较高，可切换平台后查看。
          </p>
        )}
        <div
          className={cn(
            "mb-4 grid gap-3",
            product?.platform === "macos"
              ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"
              : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
          )}
        >
          {pageCandidates.map((candidate) => {
            const isSelf = String(candidate.trackId) === String(product?.trackId ?? "");
            const isAdded = isAddedCandidate(candidate);
            return (
              <div
                key={candidate.trackId}
                className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden flex flex-col"
              >
                <div
                  className={cn(
                    "w-full overflow-hidden bg-zinc-100 dark:bg-zinc-800",
                    product?.platform === "macos" ? "aspect-[4/3]" : "aspect-[3/4]",
                  )}
                >
                  {candidate.screenshotUrl ? (
                  <img
                    src={candidate.screenshotUrl}
                    alt={candidate.trackName}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                  ) : (
                  <div className="w-full h-full flex items-center justify-center text-[10px] text-zinc-400 dark:text-zinc-500">
                    无截图
                  </div>
                  )}
                </div>
                <div className="p-2.5 flex-1 flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      (window as any).appilot?.openAppPage(appStorePageUrl(candidate));
                    }}
                    disabled={!candidate.trackId}
                    className={cn(
                      "text-sm font-medium truncate text-left",
                      candidate.trackId
                        ? "text-zinc-800 dark:text-zinc-200 hover:text-amber-600 dark:hover:text-amber-400 hover:underline"
                        : "text-zinc-800 dark:text-zinc-200 cursor-default",
                    )}
                    title="在网页中打开 App Store 页面"
                  >
                    {candidate.trackName}
                  </button>
                  {(candidate.subtitle || candidate.description) && (
                    <p className="text-[11px] text-zinc-400 dark:text-zinc-500 line-clamp-2 leading-4">
                      {candidate.subtitle ||
                        (candidate.description
                          ? String(candidate.description).slice(0, 140)
                          : "")}
                    </p>
                  )}
                  <div className="mt-auto pt-1.5 flex items-center justify-between gap-2">
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                      {candidate.genre || "未知分类"}
                      {candidate.averageUserRating ? ` · ★${Number(candidate.averageUserRating).toFixed(1)}` : ""}
                    </p>
                    {isSelf ? (
                      <span className="inline-flex px-2 py-1 rounded-md bg-zinc-100 dark:bg-zinc-800 text-[11px] text-zinc-500 dark:text-zinc-400">
                        当前应用
                      </span>
                    ) : isAdded ? (
                      <span className="inline-flex px-2 py-1 rounded-md bg-emerald-50 dark:bg-emerald-500/10 text-[11px] text-emerald-600 dark:text-emerald-400">
                        已添加
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleAdd(candidate)}
                        disabled={adding === candidate.trackId || atLimit}
                        className={btnSmPrimary}
                        title={atLimit ? `该关键词最多关联 ${MAX_COMPETITORS_PER_KEYWORD} 个竞品` : undefined}
                      >
                        {adding === candidate.trackId
                          ? "添加中…"
                          : atLimit
                            ? "已达上限"
                            : "添加"}
                      </button>
                    )}
                  </div>
                  {(candidate.countries && candidate.countries.length > 0) && (
                    <p className="text-[10px] text-zinc-400 dark:text-zinc-500 truncate">
                      {candidate.countries
                        .map(
                          (c: string) =>
                            `${storefrontDisplayName(c)}${
                              candidate.ranks?.[c] ? `#${candidate.ranks[c]}` : ""
                            }`,
                        )
                        .join("  ")}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {totalPages > 1 && (
          <div className="mb-4 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => setPage((v) => Math.max(0, v - 1))}
              disabled={safePage === 0}
              className={btnSmSecondary}
            >
              上一页
            </button>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {safePage + 1} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((v) => Math.min(totalPages - 1, v + 1))}
              disabled={safePage >= totalPages - 1}
              className={btnSmSecondary}
            >
              下一页
            </button>
          </div>
        )}
        </>
      )}

      {competitors.length > 0 || profiles.length > 0 ? (
        <div className="mb-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  竞品矩阵
                  <span
                    className="ml-2 text-[10px] font-normal text-zinc-400 dark:text-zinc-500"
                    title="列按“语言/区域组”分组并连续排列，组序固定：本地化语言组（简体中文/韩语…，按语言次序）→ 英语组（en 词在英语地区商店 us/gb/au/ca/nz/ie 的跨店综合）→ 全局组（en 词在其它语言商店如 kr/jp/de 的跨店综合）；同一 en 词可在英语与全局两组各占一列（视为不同维度）。组内关键词按“组内被多少竞品命中”降序；该组无数据（无商店快照）的词不生成列。"
                  >
                    行 = 竞品（指数降序）· 列 = 关键词（按语言/区域组排列，≤40 列）· 点击行展开商店级对比
                  </span>
                </h3>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-zinc-400 dark:text-zinc-500">
                  <span title="跨商店综合：每个格子统计该 (词 × 组) 覆盖商店集里“我领先 : 它领先”的商店数">格 = “我领先 : 它领先” 的商店数（跨商店综合）</span>
                  <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-emerald-500/70" />绿 = 我方占优</span>
                  <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-red-500/70" />红 = 竞品占优</span>
                  <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-amber-400/80" />琥珀 = 胶着</span>
                  <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-zinc-300 dark:bg-zinc-600" />灰 = 无数据/未采集</span>
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                {wordDrill && (
                  <span
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-500/10 text-[11px] text-amber-700 dark:text-amber-400 ring-1 ring-amber-500/40"
                    title={`聚焦「${wordDrill}」× 全部竞品的对比（矩阵只保留该词列）；关闭后回到完整矩阵`}
                  >
                    <span className="font-mono max-w-36 truncate">{wordDrill}</span>
                    <button
                      type="button"
                      onClick={() => setFocusCleared(true)}
                      className="hover:underline"
                      title="关闭聚焦，回到完整矩阵"
                    >
                      ✕
                    </button>
                  </span>
                )}
                <span className="text-[11px] text-zinc-400 dark:text-zinc-500 whitespace-nowrap">
                  当前平台 {platformLabel(viewPlatform)} · 近 7 天窗口
                </span>
                <button
                  type="button"
                  onClick={() => void handleScanOnChart()}
                  disabled={scanBusy}
                  className={btnSmSecondary}
                  title="只扫我方在榜词，发现已跟踪竞品的新交集并回填排名；未跟踪 App 记入候选（每日限流一次）"
                >
                  {scanBusy ? "扫描在榜词…" : "扫描在榜词"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleRefreshRanks()}
                  disabled={refreshingRanks}
                  className={btnSmSecondary}
                  title="为所有竞品的关联关键词补采一次最新排名"
                >
                  {refreshingRanks ? "采集中…" : "刷新排名"}
                </button>
              </div>
            </div>
          </div>
          {scanMsg && (
            <p className="px-4 py-2 text-[11px] text-amber-600 dark:text-amber-400 border-b border-zinc-100 dark:border-zinc-800">
              {scanMsg}
            </p>
          )}
          {profiles.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-zinc-400 dark:text-zinc-500">
              暂无竞争面数据 —— 点击“扫描在榜词”或“刷新排名”开始采集（按 (竞品 × 词 × 商店) 回填后这里出现矩阵）。
            </p>
          ) : matrixCols.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-zinc-400 dark:text-zinc-500">
              {wordDrill
                ? `「${wordDrill}」暂未采集到任何竞品的排名 —— 关闭聚焦可查看完整矩阵；点“刷新排名”可为已关联词补采。`
                : "尚无采集到排名的关键词列 —— 点击“扫描在榜词”或“刷新排名”采集。"}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr>
                    <th
                      rowSpan={2}
                      className="px-3 py-1.5 text-left align-top whitespace-nowrap text-[10px] font-semibold text-zinc-500 dark:text-zinc-400"
                      title="行 = 竞品（按竞争指数降序）；点击行展开商店级对比（行 = 商店 × 列 = 词）"
                    >
                      竞品 / 指数 ↓
                    </th>
                    {colGroups.map((run) => (
                      <th
                        key={run.group.id}
                        colSpan={run.cols.length}
                        className="px-2 py-1 text-center text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 bg-zinc-50/70 dark:bg-zinc-800/40 border-l border-zinc-100 dark:border-zinc-800 whitespace-nowrap"
                        title={run.group.title}
                      >
                        {run.group.label}
                      </th>
                    ))}
                  </tr>
                  <tr className="border-b-2 border-zinc-300 dark:border-zinc-600">
                    {matrixCols.map((col) => (
                      <th
                        key={col.key}
                        className="px-1 py-1.5 align-top text-center border-l border-zinc-100 dark:border-zinc-800"
                        style={{ width: "10ch", maxWidth: "10ch", minWidth: "10ch" }}
                        title={`${col.group.label} · 「${col.keyword}」（组内 ${col.hit} 个竞品命中）`}
                      >
                        <span className="block break-words leading-tight font-mono text-[11px] text-zinc-600 dark:text-zinc-300">
                          {col.keyword}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrixRows.map((profile: any) => {
                    const competitor = profile.competitor || {};
                    const intel = profile.intel || {};
                    const expanded = expandedRowId === competitor.id;
                    const faceMap = new Map<string, any>(
                      (intel.faces || []).map((f: any) => [`${f.language}\u0000${f.keyword}`, f]),
                    );
                    return [
                      <tr
                        key={`${competitor.id}-row`}
                        onClick={() => toggleRow(competitor.id)}
                        className={cn(
                          "cursor-pointer border-b border-zinc-100 dark:border-zinc-800",
                          expanded
                            ? "bg-zinc-50/70 dark:bg-zinc-800/30"
                            : "hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30",
                        )}
                      >
                        <th
                          scope="row"
                          className="px-2 py-1.5 text-left align-top"
                          title="点击行展开/收起该竞品的商店级对比（行 = 商店 × 列 = 词）"
                        >
                          <div className="flex items-start gap-1">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className="max-w-[11rem] truncate text-xs font-semibold text-zinc-800 dark:text-zinc-200"
                                  title={competitor.name}
                                >
                                  {competitor.name}
                                </span>
                                <span className="flex gap-0.5 shrink-0">
                                  {(["ios", "macos"] as const).map((p) => (
                                    <span
                                      key={p}
                                      className={cn(
                                        "px-1 py-px rounded text-[9px] font-medium leading-none",
                                        competitorTrackId(competitor, p)
                                          ? "bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                          : "bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-600",
                                      )}
                                      title={
                                        competitorTrackId(competitor, p)
                                          ? `已关联 ${p === "macos" ? "macOS" : "iOS"} 版本`
                                          : `未关联 ${p === "macos" ? "macOS" : "iOS"} 版本`
                                      }
                                    >
                                      {p === "macos" ? "macOS" : "iOS"}
                                    </span>
                                  ))}
                                </span>
                                <span className="ml-auto shrink-0 text-[9px] text-zinc-400 dark:text-zinc-500 whitespace-nowrap">
                                  {expanded ? "▲ 收起" : "▼ 展开"}
                                </span>
                              </div>
                              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-zinc-400 dark:text-zinc-500">
                                <span title="竞争指数：Σ 权重(我方名次段) × 威胁 × 长尾降权（近 7 天窗口）">
                                  指数 <b className="font-semibold text-amber-600 dark:text-amber-400">{intel.index}</b>
                                </span>
                                <span title="压我 = 该竞品名次更靠前、或它上榜我未上榜的词数">
                                  压我 <b className="font-semibold text-red-500 dark:text-red-400">{intel.pressuredCount}</b> 词
                                </span>
                                <span title="重叠 = 双方都跟踪的词数">
                                  重叠 <b className="font-semibold text-zinc-700 dark:text-zinc-200">{intel.faceCount}</b> 词
                                </span>
                                <span title="在榜 = 它进前 200 的词数">
                                  在榜 <b className="font-semibold text-zinc-700 dark:text-zinc-200">{intel.theirOnChart}</b> 词
                                </span>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleRemove(competitor.id);
                              }}
                              className="shrink-0 mt-0.5 w-4 text-zinc-300 dark:text-zinc-600 hover:text-red-500 text-xs"
                              title="移除竞品"
                            >
                              ✕
                            </button>
                          </div>
                        </th>
                        {matrixCols.map((col) =>
                          renderCell(col, faceMap.get(`${col.lang}\u0000${col.keyword}`)),
                        )}
                      </tr>,
                      expanded && (
                        <tr key={`${competitor.id}-detail`} className="border-b border-zinc-200/70 dark:border-zinc-800">
                          <td colSpan={totalCols + 1} className="px-4 py-3 bg-zinc-50/60 dark:bg-zinc-900/50">
                            {renderRowDetail(profile)}
                          </td>
                        </tr>
                      ),
                    ];
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {competitors.length === 0 ? (
        <p className="text-sm text-zinc-400 dark:text-zinc-500">尚未添加竞品。</p>
      ) : null}
    </div>
  );
}
