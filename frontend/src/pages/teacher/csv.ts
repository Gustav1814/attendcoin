import { formatAtc } from "@/lib/format";

type Cell = string | number | boolean | null | undefined;

function escape(cell: Cell): string {
  if (cell == null) return "";
  let text = String(cell);
  // Names come from user input; stop spreadsheets from evaluating them as formulas.
  if (typeof cell === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function downloadCsv(filename: string, header: string[], rows: Cell[][]): void {
  const body = [header, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
  const blob = new Blob(["﻿", body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function fileStamp(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** Full-precision ATC without grouping, so spreadsheets parse it as a number. */
export function csvAtc(wei: bigint): string {
  return formatAtc(wei, { maxFractionDigits: 18 }).replace(/,/g, "");
}
