// Client-side exports of the current result set. CSV is plain RFC-4180; the
// "Excel" export is a SpreadsheetML 2003 XML workbook (.xls) — a real Excel
// format that opens natively, chosen over pulling in a heavyweight XLSX library.
import type { FieldDef } from "@/lib/screener/fields";
import type { ScreenerStock } from "@/lib/screener/service";
import { rawCell } from "./format";

function triggerDownload(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const cellValue = (row: ScreenerStock, key: string): string =>
  rawCell((row as unknown as Record<string, number | string | null>)[key]);

function csvEscape(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportCsv(rows: ScreenerStock[], columns: FieldDef[], filename: string) {
  const header = columns.map((c) => csvEscape(c.label)).join(",");
  const body = rows
    .map((row) => columns.map((c) => csvEscape(cellValue(row, c.key))).join(","))
    .join("\n");
  triggerDownload(`${header}\n${body}\n`, `${filename}.csv`, "text/csv;charset=utf-8");
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function exportExcel(rows: ScreenerStock[], columns: FieldDef[], filename: string) {
  const headerCells = columns
    .map((c) => `<Cell><Data ss:Type="String">${xmlEscape(c.label)}</Data></Cell>`)
    .join("");
  const bodyRows = rows
    .map((row) => {
      const cells = columns
        .map((c) => {
          const v = (row as unknown as Record<string, number | string | null>)[c.key];
          if (v === null || v === undefined || v === "") return "<Cell><Data ss:Type=\"String\"></Data></Cell>";
          const isNum = c.type === "number" && typeof v === "number";
          const type = isNum ? "Number" : "String";
          return `<Cell><Data ss:Type="${type}">${xmlEscape(String(v))}</Data></Cell>`;
        })
        .join("");
      return `<Row>${cells}</Row>`;
    })
    .join("");

  const workbook =
    '<?xml version="1.0"?>' +
    '<?mso-application progid="Excel.Sheet"?>' +
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" ' +
    'xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
    '<Worksheet ss:Name="Screener"><Table>' +
    `<Row>${headerCells}</Row>${bodyRows}` +
    "</Table></Worksheet></Workbook>";

  triggerDownload(workbook, `${filename}.xls`, "application/vnd.ms-excel");
}
