/**
 * Overview brief renderer helpers: deterministic rule signals (AI fallback).
 */

export type BriefActionKind = "keywords" | "release" | "trend";

export interface BriefSignal {
  id: string;
  title: string;
  reason: string;
  action: BriefActionKind;
  target: string | null;
}

export interface BriefActionRecord {
  id: string;
  action: BriefActionKind;
  status: "adopted" | "ignored";
  createdAt: string;
}

export function briefRuleSignals(args: {
  rankRows: { keyword: string; language: string; bestRank: number; trend: string }[];
  trackedActiveCount: number;
  pausedCount: number;
  pendingPauseCount: number;
  languageTotal: number;
  generatedLanguageCount: number;
}): BriefSignal[] {
  const signals: BriefSignal[] = [];
  const dropped = args.rankRows.filter((row) => row.trend === "down").slice(0, 1);
  if (dropped[0]) {
    signals.push({
      id: "rule-dropout",
      title: `查看「${dropped[0].keyword}」排名下滑`,
      reason: `${dropped[0].keyword} 最近排名下滑，建议到排名页查看趋势。`,
      action: "keywords",
      target: dropped[0].keyword,
    });
  }
  if (args.languageTotal > 0 && args.generatedLanguageCount < args.languageTotal) {
    signals.push({
      id: "rule-languages",
      title: `补齐发布文案（${args.generatedLanguageCount}/${args.languageTotal} 语言）`,
      reason: "发布工作台还有语言未生成或未确定文案。",
      action: "release",
      target: null,
    });
  }
  if (args.trackedActiveCount === 0) {
    signals.push({
      id: "rule-no-keywords",
      title: "生成跟踪关键词",
      reason: "还没有跟踪关键词，先建立关键词集才能观察排名。",
      action: "keywords",
      target: null,
    });
  } else if (args.pausedCount > 0) {
    signals.push({
      id: "rule-paused",
      title: `处理 ${args.pausedCount} 个暂停关键词`,
      reason: "有跟踪关键词已暂停（人工处理），可恢复或删除。",
      action: "keywords",
      target: null,
    });
  }
  if (args.pendingPauseCount > 0) {
    signals.push({
      id: "rule-pending-pause",
      title: `复核 ${args.pendingPauseCount} 个待处理暂停关键词`,
      reason: "连续未在榜的关键词等待人工分类：恢复 / 暂停 / 移除 / 列为文案缺口。",
      action: "keywords",
      target: null,
    });
  }
  return signals.slice(0, 3);
}
