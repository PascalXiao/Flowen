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

  save(await book.xlsx.writeBuffer(), fileName);
}

function save(buffer: ArrayBuffer, fileName: string) {
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

/** 只有表头的空表：导入模板。 */
export async function downloadTemplate(fileName: string, headers: readonly string[]) {
  const { default: ExcelJS } = await import("exceljs");
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("工作项");
  sheet.columns = headers.map((h, i) => ({ header: h, width: i === 0 ? 30 : Math.max(12, h.length * 2 + 4) }));
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F3F5" } };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  save(await book.xlsx.writeBuffer(), fileName);
}

const pad = (n: number) => String(n).padStart(2, "0");
/** Excel 单元格转成文本：日期写成 YYYY-MM-DD（有时间时带上 HH:mm），其余按显示的文本。 */
function cellString(value: unknown, text: string): string {
  if (value instanceof Date) {
    // Excel 的日期没有时区，exceljs 按 UTC 读出来
    const day = `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
    const h = value.getUTCHours();
    const m = value.getUTCMinutes();
    return h || m ? `${day} ${pad(h)}:${pad(m)}` : day;
  }
  if (value && typeof value === "object" && "result" in value)
    return cellString((value as { result: unknown }).result, text);
  return text ?? "";
}

/** 读 Excel 的第一个工作表：第一行是表头，后面是数据行（每格都是文本）。 */
export async function readSheet(file: File): Promise<{ headers: string[]; rows: string[][] }> {
  const { default: ExcelJS } = await import("exceljs");
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await file.arrayBuffer());
  const sheet = book.worksheets[0];
  if (!sheet) return { headers: [], rows: [] };
  const width = sheet.columnCount;
  const read = (r: number) =>
    Array.from({ length: width }, (_, i) => {
      const cell = sheet.getRow(r).getCell(i + 1);
      return cellString(cell.value, cell.text).trim();
    });
  const headers = read(1);
  const rows: string[][] = [];
  for (let r = 2; r <= sheet.rowCount; r++) rows.push(read(r));
  return { headers, rows };
}
