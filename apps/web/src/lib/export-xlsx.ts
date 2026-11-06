import { cellText, type ListColumn, type ListItem } from "@/lib/list-columns";

/** 文件名里不能有的字符换成下划线。 */
export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, "_").trim() || "工作项";
}

/**
 * 把列表当前显示的行和列导出成 Excel：第一列是名称，后面按列表里的列顺序；
 * 数字列写成数字（Excel 里能直接求和），其他列写成和复制单元格一样的文本。
 */
export async function exportListXlsx(fileName: string, columns: readonly ListColumn[], rows: readonly ListItem[]) {
  // exceljs 体积大，只在点导出时才加载
  const { default: ExcelJS } = await import("exceljs");
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("工作项");
  sheet.columns = [
    { header: "名称", key: "name", width: 36 },
    ...columns.map((c) => ({ header: c.title, key: c.key, width: Math.max(10, Math.round(c.width / 7)) })),
  ];
  for (const item of rows) {
    const row: Record<string, string | number> = { name: item.name };
    for (const c of columns) {
      const v = c.numeric ? c.value(item) : null;
      row[c.key] = typeof v === "number" ? v : cellText(c, item);
    }
    sheet.addRow(row);
  }
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F3F5" } };
  sheet.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length + 1 } };

  const buffer = await book.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeFileName(fileName)}.xlsx`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
