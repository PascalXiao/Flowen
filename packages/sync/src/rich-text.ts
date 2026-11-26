/** 纯文本转成富文本 HTML：转义后包进段落，换行变成 <br>（开放接口、自动化发的评论用）。 */
export function textToHtml(text: string): string {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<p>${escaped.replace(/\r?\n/g, "<br>")}</p>`;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };

/** 富文本 HTML 的纯文字（搜索摘要、通知、悬浮预览用）：块级标签换成空格，去掉其余标签。 */
export function htmlToText(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/li|\/h[1-3]|\/blockquote|\/pre)\b[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e: string) => ENTITIES[e] ?? "")
    .replace(/\s+/g, " ")
    .trim();
}
