import type { ReactNode } from "react";
import { LanguageTabs } from "./LanguageTabs";
import { SubmissionCopyFields, type CopyField } from "./SubmissionCopyFields";

/**
 * 语言选项卡页面：选项卡栏 + 内容页（提交文案字段）一体。标签栏通过外层
 * 负边距覆盖内容页顶边线，两者之间不会出现缝隙；两页（工作单/历史查看）
 * 共用，字段下方的额外内容（如翻译按钮）通过 footer 传入。
 */
export function CopyTabPage({
  languages,
  activeLanguage,
  onSelect,
  localization,
  readOnly = false,
  onChange,
  productTrackName,
  hints = false,
  translatingLanguages,
  generatedLanguages,
  footer,
}: {
  languages: string[];
  activeLanguage: string;
  onSelect: (language: string) => void;
  localization: any;
  readOnly?: boolean;
  onChange?: (field: CopyField, value: string) => void;
  productTrackName?: string | null;
  hints?: boolean;
  translatingLanguages?: Set<string>;
  generatedLanguages?: string[];
  /** 内容页内、字段下方的额外内容（如翻译按钮）。 */
  footer?: ReactNode;
}) {
  return (
    <div>
      <LanguageTabs
        languages={languages}
        activeLanguage={activeLanguage}
        onSelect={onSelect}
        translatingLanguages={translatingLanguages}
        generatedLanguages={generatedLanguages}
      />
      <div className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden">
        <div className="p-4 space-y-4">
          {localization && (
            <SubmissionCopyFields
              localization={localization}
              readOnly={readOnly}
              onChange={onChange}
              productTrackName={productTrackName}
              hints={hints}
            />
          )}
          {footer}
        </div>
      </div>
    </div>
  );
}
