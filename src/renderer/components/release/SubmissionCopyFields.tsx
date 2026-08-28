import { cn } from "../../lib/utils";
import { FieldHeader } from "../ui/Fields";
import { inputClass, inputLineClass } from "../ui/styles";

/**
 * 提交文案字段（应用信息 + 软件版本信息）：发布工作单（可编辑）与历史/最新
 * 文案查看（只读）共用。字段与 ASC 上限一致：名称 30、副标题 30、推广文本
 * 170、描述 4000、新增内容 4000、关键词 100。
 */

export type CopyField =
  | "name"
  | "subtitle"
  | "promotionalText"
  | "description"
  | "whatsNew"
  | "keywords";

const FIELD_LIMITS: Record<CopyField, number> = {
  name: 30,
  subtitle: 30,
  promotionalText: 170,
  description: 4000,
  whatsNew: 4000,
  keywords: 100,
};

function charCounterClass(len: number, max: number): string {
  return cn(
    "text-[11px] px-1",
    len >= max
      ? "text-red-500"
      : len >= max * 0.9
        ? "text-amber-600/90 dark:text-amber-500/90"
        : "text-zinc-400 dark:text-zinc-500",
  );
}

export function SubmissionCopyFields({
  localization,
  readOnly = false,
  onChange,
  productTrackName,
  hints = false,
}: {
  localization: any;
  readOnly?: boolean;
  onChange?: (field: CopyField, value: string) => void;
  productTrackName?: string | null;
  /** 编辑模式下的补充提示（名称建议、未设置提示等）。 */
  hints?: boolean;
}) {
  const loc = localization || {};
  const display = (field: CopyField): string => {
    let value = String(loc[field] || "");
    // 历史遗留的描述分段标记只影响展示，不影响存储。
    if (readOnly && field === "description") {
      value = value.replace(/^──── 介绍 ────\n?/, "");
    }
    return value;
  };
  const name = display("name") || (readOnly ? String(productTrackName || "") : "");
  const set = (field: CopyField, value: string) => {
    if (!readOnly) onChange?.(field, value);
  };

  const fieldControl = (field: CopyField, multiline = false, minHeight = "") => {
    const value = field === "name" ? name : display(field);
    const props: Record<string, any> = { value };
    if (readOnly) {
      props.readOnly = true;
    } else {
      props.onChange = (e: any) => set(field, e.target.value);
      props.maxLength = FIELD_LIMITS[field];
    }
    return multiline ? (
      <textarea {...props} className={inputClass + ` ${minHeight} resize-y`} />
    ) : (
      <input {...props} className={inputLineClass} />
    );
  };

  const counter = (field: CopyField) => {
    const len = display(field).length;
    const max = FIELD_LIMITS[field];
    return (
      <p className={charCounterClass(len, max)}>
        {len}/{max} 字符
      </p>
    );
  };

  return (
    <>
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-4">
        <p className="text-[11px] font-semibold tracking-wider text-zinc-400 dark:text-zinc-500">
          应用信息
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <FieldHeader label="软件名称" text={display("name")} />
            {fieldControl("name")}
            {hints && !readOnly && !display("name") && (
              <p className="text-[11px] text-amber-600/80 dark:text-amber-500/70 px-1">
                名称未设置，商店当前显示 App 级名称：{productTrackName || "—"}
              </p>
            )}
            {hints && !readOnly && (
              <p className="text-[11px] text-amber-600/80 dark:text-amber-500/70 px-1">
                建议：名称后加冒号和描述性短句（如 GloWalk: Path of Light）
              </p>
            )}
            {counter("name")}
          </div>
          <div className="space-y-1.5">
            <FieldHeader label="软件副标题" text={display("subtitle")} />
            {fieldControl("subtitle")}
            {hints && !readOnly && !display("subtitle") && (
              <p className="text-[11px] text-amber-600/80 dark:text-amber-500/70 px-1">
                副标题未设置
              </p>
            )}
            {counter("subtitle")}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-4">
        <p className="text-[11px] font-semibold tracking-wider text-zinc-400 dark:text-zinc-500">
          软件版本信息
        </p>
        <div className="space-y-1.5">
          <FieldHeader label="推广文本" text={display("promotionalText")} />
          {fieldControl("promotionalText")}
          {counter("promotionalText")}
        </div>
        <div className="space-y-1.5">
          <FieldHeader label="软件描述" text={display("description")} />
          {fieldControl("description", true, "min-h-40")}
          {counter("description")}
        </div>
        <div className="space-y-1.5">
          <FieldHeader label="新增内容" text={display("whatsNew")} />
          {fieldControl("whatsNew", true, "min-h-28")}
          {counter("whatsNew")}
        </div>
        <div className="space-y-1.5">
          <FieldHeader label="关键词（提交字段）" text={display("keywords")} />
          {fieldControl("keywords")}
          {counter("keywords")}
        </div>
      </div>
    </>
  );
}
