import { useEffect, useState } from "react";
import {
  COPY_PLAN_FIELDS,
  type CopyPlanField,
  type CopyPlanItem,
} from "@appilot-labs/appilot-core/copy-plan";
import { formatHumanTime, languageLabel } from "../../lib/format";
import { cn } from "../../lib/utils";
import { btnSmPrimary, btnSmSecondary } from "../ui/styles";

const FIELD_LABELS: Record<CopyPlanField, string> = {
  name: "名称",
  subtitle: "副标题",
  promotionalText: "推广文本",
  description: "描述",
  keywords: "关键词",
};

type Draft = {
  id?: string;
  title: string;
  instruction: string;
  reason: string;
  fields: CopyPlanField[];
  languages: string[];
};

const emptyDraft = (): Draft => ({
  title: "",
  instruction: "",
  reason: "",
  fields: ["description"],
  languages: [],
});

export function CopyPlanPanel({
  projectId,
  productId,
  supportedLanguages,
  busy,
}: {
  projectId: string;
  productId: string;
  supportedLanguages: { code: string; name?: string }[];
  busy: boolean;
}) {
  const [items, setItems] = useState<CopyPlanItem[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    if (!projectId || !productId) return;
    const value = await (window as any).appilot?.release?.listCopyPlans(projectId, productId);
    setItems(Array.isArray(value) ? value : []);
  };

  useEffect(() => {
    setDraft(null);
    setError("");
    void load().catch((err: any) => setError(err?.message || "文案计划读取失败"));
  }, [projectId, productId]);

  useEffect(() => {
    const listener = (event: Event) => {
      const scope = (event as CustomEvent<string>).detail;
      if (scope === "releases" || scope === "projects") void load().catch(() => undefined);
    };
    window.addEventListener("appilot:data-changed", listener);
    return () => window.removeEventListener("appilot:data-changed", listener);
  }, [projectId, productId]);

  if (!productId) return null;

  const edit = (item: CopyPlanItem) => setDraft({
    id: item.id,
    title: item.title,
    instruction: item.instruction,
    reason: item.reason,
    fields: [...item.fields],
    languages: [...item.languages],
  });

  const save = async () => {
    if (!draft || saving) return;
    setSaving(true);
    setError("");
    try {
      await (window as any).appilot?.release?.saveCopyPlan(projectId, productId, draft);
      await load();
      setDraft(null);
    } catch (err: any) {
      setError(err?.message || "文案计划保存失败");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item: CopyPlanItem) => {
    const used = item.lastUsedAt
      ? `\n最近用于 ${formatHumanTime(item.lastUsedAt)}生成的文案；删除不会影响已经生成的文案。`
      : "";
    if (!window.confirm(`删除文案计划“${item.title}”？${used}`)) return;
    setError("");
    try {
      await (window as any).appilot?.release?.deleteCopyPlan(projectId, productId, item.id);
      await load();
      if (draft?.id === item.id) setDraft(null);
    } catch (err: any) {
      setError(err?.message || "文案计划删除失败");
    }
  };

  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-4 border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">文案计划</h3>
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">{items.length}</span>
          </div>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">长期保存的改进方向，会像 README 一样自动作为发布文案生成素材。</p>
        </div>
        <button type="button" onClick={() => setDraft(emptyDraft())} disabled={busy || Boolean(draft)} className={cn(btnSmPrimary, "disabled:opacity-50")}>
          添加计划
        </button>
      </div>

      {draft && (
        <div className="space-y-4 border-b border-zinc-100 bg-zinc-50/50 px-5 py-4 dark:border-zinc-800 dark:bg-zinc-950/20">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-zinc-500 dark:text-zinc-400">
              标题
              <input value={draft.title} maxLength={80} onChange={(event) => setDraft({ ...draft, title: event.target.value })} className="mt-1.5 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 outline-none focus:border-amber-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200" placeholder="例如：突出离线使用场景" />
            </label>
            <label className="text-xs text-zinc-500 dark:text-zinc-400">
              原因（可选）
              <input value={draft.reason} maxLength={500} onChange={(event) => setDraft({ ...draft, reason: event.target.value })} className="mt-1.5 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 outline-none focus:border-amber-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200" placeholder="记录提出这项改进的依据" />
            </label>
          </div>
          <label className="block text-xs text-zinc-500 dark:text-zinc-400">
            改进内容
            <textarea value={draft.instruction} maxLength={1000} rows={3} onChange={(event) => setDraft({ ...draft, instruction: event.target.value })} className="mt-1.5 w-full resize-y rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 outline-none focus:border-amber-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200" placeholder="说明下一次生成文案时应该如何改进" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">目标字段</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {COPY_PLAN_FIELDS.map((field) => {
                  const selected = draft.fields.includes(field);
                  return <button key={field} type="button" onClick={() => setDraft({ ...draft, fields: selected ? draft.fields.filter((item) => item !== field) : [...draft.fields, field] })} className={cn("rounded-lg border px-2.5 py-1.5 text-xs", selected ? "border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400" : "border-zinc-200 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400")}>{FIELD_LABELS[field]}</button>;
                })}
              </div>
            </div>
            <div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">适用语言</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <button type="button" onClick={() => setDraft({ ...draft, languages: [] })} className={cn("rounded-lg border px-2.5 py-1.5 text-xs", draft.languages.length === 0 ? "border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400" : "border-zinc-200 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400")}>全部语言</button>
                {supportedLanguages.map((language) => {
                  const selected = draft.languages.includes(language.code);
                  return <button key={language.code} type="button" onClick={() => setDraft({ ...draft, languages: selected ? draft.languages.filter((item) => item !== language.code) : [...draft.languages, language.code] })} className={cn("rounded-lg border px-2.5 py-1.5 text-xs", selected ? "border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400" : "border-zinc-200 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400")}>{languageLabel(language.code)}</button>;
                })}
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDraft(null)} className={btnSmSecondary}>取消</button>
            <button type="button" onClick={() => void save()} disabled={saving || !draft.title.trim() || !draft.instruction.trim() || draft.fields.length === 0} className={cn(btnSmPrimary, "disabled:opacity-50")}>{saving ? "保存中…" : "保存"}</button>
          </div>
        </div>
      )}

      {error && <p className="px-5 pt-3 text-xs text-red-500 dark:text-red-400">{error}</p>}
      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {items.length === 0 ? (
          <p className="px-5 py-5 text-sm text-zinc-400 dark:text-zinc-500">还没有文案计划。可以手动添加，或让副驾把建议记录到这里。</p>
        ) : items.map((item) => (
          <div key={item.id} className="flex items-start gap-4 px-5 py-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{item.title}</p>
              <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-zinc-600 dark:text-zinc-300">{item.instruction}</p>
              {item.reason && <p className="mt-1 text-[11px] text-zinc-400">依据：{item.reason}</p>}
              <p className="mt-2 text-[10px] text-zinc-400">
                {item.fields.map((field) => FIELD_LABELS[field]).join("、")} · {item.languages.length > 0 ? item.languages.map(languageLabel).join("、") : "全部语言"} · {item.source === "copilot" ? "副驾添加" : "手动添加"}
                {item.lastUsedAt ? ` · ${formatHumanTime(item.lastUsedAt)}用于文案生成` : ""}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <button type="button" onClick={() => edit(item)} disabled={busy || Boolean(draft)} className="text-xs text-zinc-400 hover:text-zinc-600 disabled:opacity-40 dark:hover:text-zinc-200">编辑</button>
              <button type="button" onClick={() => void remove(item)} disabled={busy} className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40 dark:hover:text-red-300">删除</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
