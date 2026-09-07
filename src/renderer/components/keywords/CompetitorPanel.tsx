import { useCallback, useEffect, useState } from "react";
import { storefrontDisplayName, storefrontsForLanguage } from "@appilot-labs/appilot-core/storefronts";
import { platformLabel } from "../../lib/format";
import { cn } from "../../lib/utils";
import { btnPrimary, btnSmPrimary, btnSmSecondary } from "../ui/styles";
import { ValueFlash } from "../ui/ValueFlash";

// —— 竞品矩阵（纯计算辅助，模块级）——
// 语言标签：矩阵列头分组 + 行展开分组标题。
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
// 交集状态（词行“状态”列）。
const FACE_STATUS_LABEL: Record<string, string> = {
  both: "正面竞争",
  competitorOnly: "它上榜我未上榜",
  selfOnly: "我上榜它未上榜",
  offChart: "双方 200 外",
  unknown: "未采集",
};
const SEG_EN_LOCAL_TIP = "英 = 英语地区商店 us/gb/au/ca/nz/ie 的跨店综合";
const SEG_EN_GLOBAL_TIP = "全 = 该英语词在其它语言商店（如 kr/jp/de）的跨店综合";

interface SegDef {
  segId: "local" | "global";
  label: string; // 列头/段芯片短标（英 / 全 / 本地）
  title: string;
  stores: string[]; // 该段覆盖的商店集合（与 face.cells 求交聚合）
}
interface MatrixCol {
  key: string; // `${language}\u0000${keyword}`
  lang: string;
  keyword: string;
  hit: number; // 命中该词的竞品数（排序用）
  segs: SegDef[];
}

// 列内分段：英语词 local 段 = storefrontsForLanguage("en")（us/gb/au/ca/nz/ie），
// 其余商店归 global（“全”，如 kr/jp/de）；非英语词只有单一“本地”子列。
function segsForColumn(lang: string, stores: string[]): SegDef[] {
  const localList = storefrontsForLanguage(lang);
  const local = stores.filter((s) => localList.includes(s));
  const global = stores.filter((s) => !localList.includes(s));
  if (lang !== "en") {
    return [
      {
        segId: "local",
        label: "本地",
        title: `该词在${FACE_LANG_LABEL[lang] || lang}商店（${localList.join("/")}）的跨店综合`,
        stores: [...stores],
      },
    ];
  }
  const segs: SegDef[] = [];
  if (local.length > 0) segs.push({ segId: "local", label: "英", title: SEG_EN_LOCAL_TIP, stores: local });
  if (global.length > 0) segs.push({ segId: "global", label: "全", title: SEG_EN_GLOBAL_TIP, stores: global });
  if (segs.length === 0) segs.push({ segId: "local", label: "英", title: SEG_EN_LOCAL_TIP, stores: [] });
  return segs;
}

function compareCols(a: MatrixCol, b: MatrixCol): number {
  return b.hit - a.hit || langRank(a.lang) - langRank(b.lang) || a.keyword.localeCompare(b.keyword);
}

// 从 profiles（competitors:overview → {competitor, intel, indexHistory}）收集矩阵列：
// 只保留采集到 cell 的词；聚焦词时只保留该词的列，否则最多 40 列、按命中竞品数优先。
function computeMatrixCols(profiles: any[], focusWord: string, focusLang: string): MatrixCol[] {
  const byKey = new Map<string, { lang: string; keyword: string; stores: Set<string>; hit: number }>();
  for (const p of profiles || []) {
    for (const f of p?.intel?.faces || []) {
      if (!Array.isArray(f?.cells) || f.cells.length === 0) continue;
      const key = `${f.language}\u0000${f.keyword}`;
      let agg = byKey.get(key);
      if (!agg) {
        agg = { lang: f.language, keyword: f.keyword, stores: new Set<string>(), hit: 0 };
        byKey.set(key, agg);
      }
      agg.hit += 1;
      for (const cell of f.cells) if (cell?.storefront) agg.stores.add(cell.storefront);
    }
  }
  const all: MatrixCol[] = [...byKey.entries()].map(([key, agg]) => ({
    key,
    lang: agg.lang,
    keyword: agg.keyword,
    hit: agg.hit,
    segs: segsForColumn(agg.lang, [...agg.stores]),
  }));
  if (focusWord) {
    const exact = all.filter((c) => c.keyword === focusWord && c.lang === focusLang);
    const loose = all.filter((c) => c.keyword === focusWord);
    return (exact.length > 0 ? exact : loose).sort(compareCols);
  }
  return all.sort(compareCols).slice(0, 40);
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
// 格 title 明细：我最好 #x / 它最好 #y · 我领先商店 a,b / 它领先 c,d（商店中文名）。
function segDetailTitle(keyword: string, segLabel: string, agg: CellAgg): string {
  const parts: string[] = [`我最好 #${agg.myBest ?? "—"}`, `它最好 #${agg.theirBest ?? "—"}`];
  if (agg.myStores.length > 0) parts.push(`我领先：${agg.myStores.map(storefrontDisplayName).join("、")}`);
  if (agg.theirStores.length > 0) parts.push(`它领先：${agg.theirStores.map(storefrontDisplayName).join("、")}`);
  if (agg.myStores.length === 0 && agg.theirStores.length === 0) parts.push("名次并列或未上榜，无一方领先");
  return `「${keyword}」${segLabel} 段：${parts.join(" · ")}`;
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
  // 矩阵行展开 + (词 × 段) 商店明细下钻。
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [storeDrillKey, setStoreDrillKey] = useState<string | null>(null);
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
  const rankCellClass = (rank: number | null) => {
    if (rank == null) return "bg-zinc-100/70 dark:bg-zinc-800/40 text-zinc-400 dark:text-zinc-500";
    if (rank <= 10) return "bg-green-700/85 text-white";
    if (rank <= 50) return "bg-green-500/85 text-white";
    if (rank <= 100) return "bg-lime-300/80 text-green-950";
    if (rank <= 200) return "bg-yellow-300/80 text-yellow-950";
    return "bg-zinc-200/80 text-zinc-600 dark:bg-zinc-700/70 dark:text-zinc-300";
  };
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

  // —— 竞品矩阵：行列推导 ——
  const matrixRows: any[] = [...profiles].sort(
    (a: any, b: any) =>
      (b.intel?.index ?? 0) - (a.intel?.index ?? 0) ||
      String(a.competitor?.name ?? "").localeCompare(String(b.competitor?.name ?? "")),
  );
  const matrixCols = computeMatrixCols(matrixRows, wordDrill, viewLang || "en");
  const segTotal = matrixCols.reduce((n: number, c: MatrixCol) => n + c.segs.length, 0);
  const needsSegRow = matrixCols.some((c: MatrixCol) => c.segs.length > 1);
  const headerRows = needsSegRow ? 3 : 2;
  const colRuns: Array<{ lang: string; span: number }> = [];
  for (const col of matrixCols) {
    const span = col.segs.length;
    const last = colRuns[colRuns.length - 1];
    if (last && last.lang === col.lang) last.span += span;
    else colRuns.push({ lang: col.lang, span });
  }
  const toggleRow = (competitorId: string) => {
    setExpandedRowId((prev) => (prev === competitorId ? null : competitorId));
    setStoreDrillKey(null);
  };

  // —— 竞品矩阵渲染辅助 ——
  // (竞品 × 词 × 段) 的跨店综合格。
  const renderSegCell = (col: MatrixCol, seg: SegDef, face: any) => {
    const agg = aggregateCells(face?.cells || [], seg.stores);
    const hasData = agg.myBest != null || agg.theirBest != null;
    const tone = leadTone(agg.myLead, agg.theirLead, hasData);
    const title = hasData
      ? segDetailTitle(col.keyword, seg.label, agg)
      : `「${col.keyword}」${seg.label} 段：无该竞品排名数据（未采集 / 该段无商店）`;
    return (
      <td key={`${col.key}:${seg.segId}`} className="p-0.5">
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
  // 商店级下钻表：行 = 商店，列 = 我方 / 竞品名次。
  const renderStoreDrill = (face: any, cells: any[], segLabel: string) => (
    <div className="overflow-hidden rounded-lg border border-zinc-200/80 dark:border-zinc-700/60">
      <div className="flex items-center justify-between px-2 py-1 bg-zinc-100/70 dark:bg-zinc-800/40">
        <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
          「{face.keyword}」× {segLabel} 段 · 商店级明细（近 7 天窗口）
        </p>
        <p className="text-[10px] text-zinc-400 dark:text-zinc-500">名次越小越好 · 未上榜 = 该店无名次数据</p>
      </div>
      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr className="text-left">
            <th className="py-1 px-2 font-medium text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-700/60 whitespace-nowrap">商店</th>
            <th className="py-1 px-2 font-medium text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-700/60 text-center">我方</th>
            <th className="py-1 px-2 font-medium text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-700/60 text-center">竞品</th>
          </tr>
        </thead>
        <tbody>
          {cells.map((cell: any) => {
            const ownRank: number | null = typeof cell?.own === "number" ? (cell.own as number) : null;
            const theirRank: number | null =
              typeof cell?.theirs === "number" ? (cell.theirs as number) : null;
            return (
              <tr key={cell.storefront} className="border-b border-zinc-100 dark:border-zinc-800 last:border-0">
                <td className="py-1 px-2 text-zinc-600 dark:text-zinc-300 whitespace-nowrap">
                  {storefrontDisplayName(cell.storefront)}
                  <span className="ml-1 font-mono text-[9px] text-zinc-400 dark:text-zinc-500">{cell.storefront}</span>
                </td>
                <td className={cn("py-1 px-2 text-center whitespace-nowrap font-medium", rankCellClass(ownRank))}>
                  <ValueFlash value={ownRank}>{ownRank != null ? `#${ownRank}` : "未上榜"}</ValueFlash>
                </td>
                <td className={cn("py-1 px-2 text-center whitespace-nowrap font-medium", rankCellClass(theirRank))}>
                  <ValueFlash value={theirRank}>{theirRank != null ? `#${theirRank}` : "未上榜"}</ValueFlash>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
  // 单个 face → (英 / 全 / 本地) 段切片，供词行段芯片与商店下钻复用。
  const faceParts = (face: any): Array<{ label: string; title: string; cells: any[]; agg: CellAgg }> => {
    const cells: any[] = face?.cells || [];
    if (cells.length === 0) return [];
    if (face.language === "en") {
      const enList = storefrontsForLanguage("en");
      const parts: Array<{ label: string; title: string; cells: any[]; agg: CellAgg }> = [];
      const localCells = cells.filter((c: any) => enList.includes(c.storefront));
      const globalCells = cells.filter((c: any) => !enList.includes(c.storefront));
      if (localCells.length > 0)
        parts.push({ label: "英", title: SEG_EN_LOCAL_TIP, cells: localCells, agg: aggregateCells(localCells) });
      if (globalCells.length > 0)
        parts.push({ label: "全", title: SEG_EN_GLOBAL_TIP, cells: globalCells, agg: aggregateCells(globalCells) });
      return parts;
    }
    return [
      {
        label: "本地",
        title: `该词在${FACE_LANG_LABEL[face.language] || face.language}商店（${storefrontsForLanguage(face.language).join("/")}）的跨店综合`,
        cells,
        agg: aggregateCells(cells),
      },
    ];
  };
  // 行展开词列表中的一行：关键词 + 段芯片（英 2:1 / 全 0:3，同矩阵配色）+ 状态。
  // 点击段芯片展开该 (词 × 段) 的商店级明细表。
  const renderWordItem = (face: any) => {
    const parts = faceParts(face);
    const wordKey = `${face.language}\u0000${face.keyword}`;
    const status = FACE_STATUS_LABEL[face.overlap] || face.overlap || "未知";
    return (
      <div key={wordKey} className="py-1">
        <div className="flex items-center gap-2">
          <span
            className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-800 dark:text-zinc-200"
            title={`${face.keyword}（${FACE_LANG_LABEL[face.language] || face.language}）${face.longTail ? " · 双方最新都在 200 名后（长尾降权）" : ""}`}
          >
            {face.keyword}
            {face.longTail && (
              <span className="ml-1.5 px-1 py-px rounded text-[9px] bg-zinc-100 dark:bg-zinc-800 text-zinc-400 align-middle">
                长尾
              </span>
            )}
          </span>
          {parts.map((part) => {
            const drillKey = `${wordKey}\u0000${part.label}`;
            const open = storeDrillKey === drillKey;
            const tone = leadTone(
              part.agg.myLead,
              part.agg.theirLead,
              part.agg.myBest != null || part.agg.theirBest != null,
            );
            return (
              <button
                type="button"
                key={part.label}
                onClick={() => setStoreDrillKey(open ? null : drillKey)}
                title={`${part.title}｜${segDetailTitle(face.keyword, part.label, part.agg)}（点击${open ? "收起" : "展开"}商店明细）`}
                className={cn(
                  "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums transition-shadow",
                  tone.cls,
                  open && "ring-2 ring-amber-500/60",
                )}
              >
                {part.label} {tone.text}
              </button>
            );
          })}
          <span
            className="shrink-0 w-28 text-right text-[10px] text-zinc-400 dark:text-zinc-500"
            title={`交集状态（近 7 天窗口）＝ ${status}${face.contribution > 0 ? `；指数贡献 +${face.contribution}` : ""}`}
          >
            {status}
            {face.contribution > 0 && <span className="ml-0.5 text-amber-600 dark:text-amber-400">+{face.contribution}</span>}
          </span>
        </div>
        {parts
          .filter((part) => storeDrillKey === `${wordKey}\u0000${part.label}`)
          .map((part) => (
            <div key={`drill-${part.label}`} className="mt-1.5">
              {renderStoreDrill(face, part.cells, part.label)}
            </div>
          ))}
      </div>
    );
  };
  // 行展开 = 词级汇总：按语言分组；英语语言内部再拆“英语地区 / 全局”两组。
  const renderRowDetail = (profile: any) => {
    const intel = profile.intel || {};
    const faces: any[] = intel.faces || [];
    if (faces.length === 0) {
      return (
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          尚无采集数据（手动关联的关键词会出现在列表里，等待采集）。
        </p>
      );
    }
    const byLang = new Map<string, any[]>();
    for (const f of faces) {
      const lang = String(f.language ?? "en");
      const list = byLang.get(lang) || [];
      list.push(f);
      byLang.set(lang, list);
    }
    const langs = [...byLang.keys()].sort((a, b) => langRank(a) - langRank(b));
    return (
      <div className="space-y-3">
        {langs.map((lang) => {
          const list = byLang.get(lang)!;
          if (lang === "en") {
            const enList = storefrontsForLanguage("en");
            const enLocal: any[] = [];
            const enGlobalOnly: any[] = [];
            for (const f of list) {
              const cells: any[] = f.cells || [];
              const hasLocal = cells.some((c: any) => enList.includes(c.storefront));
              if (cells.length === 0 || hasLocal) enLocal.push(f);
              else enGlobalOnly.push(f);
            }
            return (
              <div key={lang}>
                <p className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
                  英语
                  <span className="font-normal text-zinc-400 dark:text-zinc-500"> · {list.length} 个词</span>
                </p>
                {enLocal.length > 0 && (
                  <div className="mt-1 ml-2 border-l-2 border-zinc-100 dark:border-zinc-800 pl-2">
                    <p className="mb-0.5 text-[10px] text-zinc-400 dark:text-zinc-500" title={SEG_EN_LOCAL_TIP}>
                      英语地区
                    </p>
                    {enLocal.map(renderWordItem)}
                  </div>
                )}
                {enGlobalOnly.length > 0 && (
                  <div className="mt-1 ml-2 border-l-2 border-zinc-100 dark:border-zinc-800 pl-2">
                    <p className="mb-0.5 text-[10px] text-zinc-400 dark:text-zinc-500" title={SEG_EN_GLOBAL_TIP}>
                      全局
                    </p>
                    {enGlobalOnly.map(renderWordItem)}
                  </div>
                )}
              </div>
            );
          }
          return (
            <div key={lang}>
              <p className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
                {FACE_LANG_LABEL[lang] || lang}
                <span className="font-normal text-zinc-400 dark:text-zinc-500"> · {list.length} 个词</span>
              </p>
              <div className="mt-1 ml-2 border-l-2 border-zinc-100 dark:border-zinc-800 pl-2">{list.map(renderWordItem)}</div>
            </div>
          );
        })}
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
                  <span className="ml-2 text-[10px] font-normal text-zinc-400 dark:text-zinc-500">
                    行 = 竞品（指数降序）· 列 = 关键词（按命中竞品数排序，≤40 列）· 点击行展开词级与商店明细
                  </span>
                </h3>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-zinc-400 dark:text-zinc-500">
                  <span title="跨商店综合：每个格子统计该 (词 × 段) 商店集里“我领先 : 它领先”的商店数">格 = “我领先 : 它领先” 的商店数（跨商店综合）</span>
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
                      rowSpan={headerRows}
                      className="px-3 py-1.5 text-left align-top whitespace-nowrap text-[10px] font-semibold text-zinc-500 dark:text-zinc-400"
                      title="行 = 竞品（按竞争指数降序）；点击行查看词级与商店明细"
                    >
                      竞品 / 指数 ↓
                    </th>
                    {colRuns.map((run) => (
                      <th
                        key={run.lang}
                        colSpan={run.span}
                        className="px-2 py-1 text-center text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 bg-zinc-50/70 dark:bg-zinc-800/40 border-l border-zinc-100 dark:border-zinc-800 whitespace-nowrap"
                        title={FACE_LANG_LABEL[run.lang] ? `${FACE_LANG_LABEL[run.lang]} 语言组` : run.lang}
                      >
                        {FACE_LANG_LABEL[run.lang] || run.lang}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {matrixCols.map((col) => (
                      <th
                        key={col.key}
                        colSpan={col.segs.length}
                        rowSpan={needsSegRow ? 1 : 2}
                        className="px-1.5 py-1 align-bottom text-center border-l border-zinc-100 dark:border-zinc-800 whitespace-nowrap"
                      >
                        <span
                          className={cn(
                            "inline-block max-w-[11rem] truncate align-bottom font-mono text-zinc-600 dark:text-zinc-300",
                            needsSegRow ? "text-[10px] leading-none" : "text-[11px]",
                          )}
                          title={`${FACE_LANG_LABEL[col.lang] || col.lang} · 「${col.keyword}」（命中 ${col.hit} 个竞品）`}
                        >
                          {col.keyword}
                        </span>
                      </th>
                    ))}
                  </tr>
                  {needsSegRow && (
                    <tr>
                      {matrixCols.flatMap((col) =>
                        col.segs.map((seg) => (
                          <th
                            key={`${col.key}:${seg.segId}`}
                            title={seg.title}
                            className="px-1.5 py-1 text-center text-[10px] font-medium text-zinc-400 dark:text-zinc-500 border-t border-l border-zinc-100 dark:border-zinc-800 whitespace-nowrap"
                          >
                            {seg.label}
                          </th>
                        )),
                      )}
                    </tr>
                  )}
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
                          title="点击行展开/收起该竞品的词级与商店明细"
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
                        {matrixCols.flatMap((col) =>
                          col.segs.map((seg) => renderSegCell(col, seg, faceMap.get(col.key))),
                        )}
                      </tr>,
                      expanded && (
                        <tr key={`${competitor.id}-detail`} className="border-b border-zinc-200/70 dark:border-zinc-800">
                          <td colSpan={segTotal + 1} className="px-4 py-3 bg-zinc-50/60 dark:bg-zinc-900/50">
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
