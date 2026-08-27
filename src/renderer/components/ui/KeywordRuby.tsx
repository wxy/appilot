import { cn } from "../../lib/utils";

/**
 * 关键词标注：当关键词不是界面语言（中文）时，用 HTML5 <ruby> 把译文
 * 标注在关键词上方。没有译文时退化为纯文本。
 */
export function KeywordRuby({
  keyword,
  translation,
  annotate,
  className,
}: {
  keyword: string;
  translation?: string | null;
  /** 是否需要标注（关键词语言 ≠ 界面语言）。 */
  annotate: boolean;
  className?: string;
}) {
  const showAnnotation = annotate && Boolean(translation && translation.trim());
  if (!showAnnotation) {
    return <span className={className}>{keyword}</span>;
  }
  return (
    <ruby className={cn("ruby-keyword", className)}>
      {keyword}
      <rt>{translation}</rt>
    </ruby>
  );
}
