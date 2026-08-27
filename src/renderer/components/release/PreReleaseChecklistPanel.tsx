import { useState } from "react";
import { cn } from "../../lib/utils";
import { languageLabel } from "../../lib/format";
import { AIProgressButton } from "../ui/AIProgressButton";

/**
 * 发布前检查单（主区域展示）：
 * - 自动检查：版本一致性、权限与能力声明；
 * - 发布前素材：多语言截图建议（名称/说明标签点击复制纯文本，位置为界面语言）。
 */
export function PreReleaseChecklistPanel({
  checklist,
  generating,
  progress,
  onGenerate,
}: {
  checklist: any;
  generating: boolean;
  progress: { chars: number; phase: "reasoning" | "content" } | null;
  onGenerate: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [shotLang, setShotLang] = useState<string | null>(null);

  const flashCopied = (key: string) => {
    setCopied(key);
    window.setTimeout(() => {
      setCopied((current) => (current === key ? null : current));
    }, 1200);
  };

  const copyText = (key: string, text: string) => {
    void navigator.clipboard?.writeText(text);
    flashCopied(key);
  };

  const checks = checklist?.checks || [];
  const material = checklist?.material || [];
  const activeShotLang = shotLang || material[0]?.language || null;
  const activeShotMaterial =
    material.find((item: any) => item.language === activeShotLang) || null;

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm">
      <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            发布前检查单
          </h4>
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
            自动检查 + 发布前素材 · 多语言
          </span>
        </div>
        <AIProgressButton
          onClick={onGenerate}
          disabled={generating}
          loading={generating}
          progress={progress}
          idleLabel={checklist ? "重新生成检查单" : "生成发布前检查单"}
        />
      </div>
      <div className="p-4 space-y-4">
        {!checklist ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400 py-2">
            尚未生成发布前检查单。
          </p>
        ) : (
          <>
            {checklist.detectedLanguages?.length > 0 && (
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                已识别语言（{checklist.detectedLanguages.length}）：{" "}
                {checklist.detectedLanguages.join("、")}
                {checklist.detectionNote ? ` · ${checklist.detectionNote}` : ""}
              </p>
            )}
            <div>
              <h5 className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 mb-2">
                自动检查
              </h5>
              <div className="space-y-1.5">
                {checks.map((check: any) => {
                  const tone =
                    check.status === "pass"
                      ? "bg-emerald-500"
                      : check.status === "fail"
                        ? "bg-red-500"
                        : check.status === "warn"
                          ? "bg-amber-500"
                          : "bg-zinc-400";
                  const statusLabel =
                    check.status === "pass"
                      ? "通过"
                      : check.status === "fail"
                        ? "不通过"
                        : check.status === "warn"
                          ? "提醒"
                          : "未知";
                  return (
                    <div key={check.id} className="flex items-start gap-2">
                      <span
                        className={cn("mt-1.5 w-2 h-2 rounded-full shrink-0", tone)}
                      />
                      <div className="min-w-0">
                        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                          {check.label}
                        </span>
                        <span className="ml-1.5 text-[10px] text-zinc-400">
                          [{statusLabel}]
                        </span>
                        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                          {check.detail}
                        </p>
                        {(check.items || []).length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {(check.items || []).map(
                              (item: { label: string; kind?: string }, index: number) => (
                                <span
                                  key={`${item.kind}:${item.label}:${index}`}
                                  className={cn(
                                    "px-1.5 py-0.5 rounded-md text-[10px]",
                                    item.kind === "capability"
                                      ? "bg-violet-100 dark:bg-violet-500/15 text-violet-700 dark:text-violet-400"
                                      : "bg-sky-100 dark:bg-sky-500/15 text-sky-700 dark:text-sky-400",
                                  )}
                                  title={
                                    item.kind === "capability"
                                      ? "能力（entitlements）"
                                      : "权限用途说明"
                                  }
                                >
                                  {item.label}
                                </span>
                              ),
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <h5 className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
                  截图建议（点击标签复制纯文本）
                </h5>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {material.map((item: any) => (
                  <button
                    key={`tab:${item.language}`}
                    type="button"
                    onClick={() => setShotLang(item.language)}
                    className={cn(
                      "px-2 py-1 rounded-lg border text-[11px] font-medium transition-colors",
                      activeShotLang === item.language
                        ? "border-sky-500 bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-400"
                        : "border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:border-sky-400/60",
                    )}
                  >
                    {languageLabel(item.language)}
                  </button>
                ))}
              </div>
              {activeShotMaterial && (
                <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-zinc-50/60 dark:bg-zinc-900/40">
                        <th className="py-2 px-3 text-left font-medium text-zinc-400 border-b border-zinc-200/70 dark:border-zinc-700/70">
                          #
                        </th>
                        <th className="py-2 px-3 text-left font-medium text-zinc-400 border-b border-l border-zinc-200/70 dark:border-zinc-700/70">
                          截图名称
                        </th>
                        <th className="py-2 px-3 text-left font-medium text-zinc-400 border-b border-l border-zinc-200/70 dark:border-zinc-700/70">
                          截图说明
                        </th>
                        <th className="py-2 px-3 text-left font-medium text-zinc-400 border-b border-l border-zinc-200/70 dark:border-zinc-700/70">
                          截图位置（界面语言）
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {(activeShotMaterial.screenshots || []).map(
                        (shot: any, index: number) => {
                          const nameKey = `${activeShotLang}:${index}:name`;
                          const descKey = `${activeShotLang}:${index}:desc`;
                          return (
                            <tr
                              key={index}
                              className="border-b border-zinc-100 dark:border-zinc-800 last:border-b-0"
                            >
                              <td className="py-2 px-3 text-zinc-400 whitespace-nowrap">
                                {index + 1}
                              </td>
                              <td className="py-2 px-3 border-l border-zinc-100 dark:border-zinc-800">
                                <button
                                  type="button"
                                  onClick={() =>
                                    copyText(nameKey, `截图名称：${shot.name}`)
                                  }
                                  title="点击复制（纯文本）"
                                  className={cn(
                                    "px-2 py-1 rounded-md border text-[11px] text-left transition-all active:scale-95",
                                    copied === nameKey
                                      ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                      : "border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:border-sky-400/60 hover:text-sky-700 dark:hover:text-sky-300",
                                  )}
                                >
                                  {shot.name || "（无）"}
                                </button>
                              </td>
                              <td className="py-2 px-3 border-l border-zinc-100 dark:border-zinc-800">
                                <button
                                  type="button"
                                  onClick={() =>
                                    copyText(descKey, `截图说明：${shot.description}`)
                                  }
                                  title="点击复制（纯文本）"
                                  className={cn(
                                    "px-2 py-1 rounded-md border text-[11px] text-left transition-all active:scale-95",
                                    copied === descKey
                                      ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                      : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:border-sky-400/60 hover:text-sky-700 dark:hover:text-sky-300",
                                  )}
                                >
                                  {shot.description || "（无）"}
                                </button>
                              </td>
                              <td className="py-2 px-3 border-l border-zinc-100 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300">
                                {shot.location || "—"}
                              </td>
                            </tr>
                          );
                        },
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
