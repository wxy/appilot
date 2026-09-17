import { useEffect, useState } from "react";
import type { ProductPromotionProfile } from "@appilot-labs/appilot-core/promotion";
import { btnPrimary, btnSecondary, inputClass, inputLineClass } from "../ui/styles";

export function PromotionProfileEditor({
  value,
  productId,
  onSave,
  onCancel,
}: {
  value: ProductPromotionProfile | null;
  productId: string;
  onSave: (value: ProductPromotionProfile) => Promise<void>;
  onCancel?: () => void;
}) {
  const [xAccount, setXAccount] = useState(value?.x?.accountLabel || "");
  const [audienceNotes, setAudienceNotes] = useState(value?.audienceNotes || "");
  const [toneNotes, setToneNotes] = useState(value?.toneNotes || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setXAccount(value?.x?.accountLabel || "");
    setAudienceNotes(value?.audienceNotes || "");
    setToneNotes(value?.toneNotes || "");
  }, [value]);

  const submit = async () => {
    setSaving(true);
    setError("");
    try {
      await onSave({
        productId,
        enabledPlatforms: ["x"],
        audienceNotes: audienceNotes.trim(),
        toneNotes: toneNotes.trim(),
        x: { accountLabel: xAccount.trim() },
        // 暂停渠道只从界面降级，保留用户以前录入的配置。
        reddit: value?.reddit || { communities: [] },
        facebook: value?.facebook || { surfaces: [] },
        updatedAt: new Date().toISOString(),
      });
    } catch (cause: any) {
      setError(cause?.message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-5">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">设置 X 推广档案</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          当前正式推广系列只面向 X，并由你手动发布。Reddit 与 Facebook Group 暂停使用，已有配置不会被删除。
        </p>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-800 dark:bg-amber-500/10">
        <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">X · 主渠道</p>
        <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-300/80">生成系列计划与单条文案；Appilot 不保存平台密码，也不会自动发帖。</p>
        <input className={`${inputLineClass} mt-3`} value={xAccount} onChange={(event) => setXAccount(event.target.value)} placeholder="账户备注，可选" />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
          目标受众备注
          <textarea className={`${inputClass} mt-1 min-h-24 resize-y`} value={audienceNotes} onChange={(event) => setAudienceNotes(event.target.value)} placeholder="哪些海外用户最可能需要这个产品？" />
        </label>
        <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
          语气备注
          <textarea className={`${inputClass} mt-1 min-h-24 resize-y`} value={toneNotes} onChange={(event) => setToneNotes(event.target.value)} placeholder="例如：克制、具体、开发者口吻" />
        </label>
      </div>

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        {onCancel && <button type="button" className={btnSecondary} onClick={onCancel}>取消</button>}
        <button type="button" className={btnPrimary} disabled={saving} onClick={submit}>{saving ? "正在保存…" : "保存并继续"}</button>
      </div>
    </section>
  );
}
