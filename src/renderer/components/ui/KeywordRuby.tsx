import { cn } from "../../lib/utils";

/**
 * 关键词标注：当关键词不是界面语言（中文）时，用 HTML5 <ruby> 把译文
 * 标注在关键词上方。没有译文时退化为纯文本。
 */
export function KeywordRuby({
  keyword,
  translation,
  annotate,
  chip = true,
  className,
}: {
  keyword: string;
  translation?: string | null;
  /** 是否需要标注（关键词语言 ≠ 界面语言）。 */
  annotate: boolean;
  /**
   * 是否渲染关键词底色标签。默认开启；外层已有胶囊/标签容器时（如竞品
   * 筛选按钮）传 false，避免双层嵌套。
   */
  chip?: boolean;
  className?: string;
}) {
  const showAnnotation = annotate && Boolean(translation && translation.trim());
  const classNames = cn("ruby-keyword", chip && "ruby-chip", className);
  if (!showAnnotation) {
    return <span className={classNames}>{keyword}</span>;
  }
  return (
    <ruby className={classNames}>
      {keyword}
      <rt>{translation}</rt>
    </ruby>
  );
}
