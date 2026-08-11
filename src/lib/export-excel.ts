import * as XLSX from "xlsx";

export type ExcelCell = string | number | boolean | null | undefined;

export type ExcelSheet = {
  /** Nom d’onglet Excel (max 31 car.) */
  name: string;
  /** Lignes objets → colonnes = clés */
  rows: Record<string, ExcelCell>[];
};

function safeSheetName(name: string): string {
  const cleaned = name.replace(/[\\/?*[\]:]/g, " ").trim() || "Feuille";
  return cleaned.slice(0, 31);
}

/** Télécharge un fichier .xlsx multi-feuilles dans le navigateur. */
export function downloadExcel(filename: string, sheets: ExcelSheet[]): void {
  if (typeof window === "undefined") {
    throw new Error("Export Excel disponible uniquement dans le navigateur");
  }
  const wb = XLSX.utils.book_new();
  const list = sheets.length
    ? sheets
    : [{ name: "Vide", rows: [{ Info: "Aucune donnée" }] }];

  for (const sheet of list) {
    const rows =
      sheet.rows.length > 0
        ? sheet.rows
        : [{ Info: "Aucune ligne pour cette feuille" }];
    const ws = XLSX.utils.json_to_sheet(rows);
    // Largeur colonnes approximative
    const keys = Object.keys(rows[0] ?? {});
    ws["!cols"] = keys.map((k) => ({
      wch: Math.min(40, Math.max(10, k.length + 2)),
    }));
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(sheet.name));
  }

  const base = filename.replace(/\.xlsx$/i, "");
  XLSX.writeFile(wb, `${base}.xlsx`);
}

export function excelFilename(
  prefix: string,
  ...parts: Array<string | null | undefined>
): string {
  const stamp = new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/[T:]/g, "-");
  const mid = parts.filter(Boolean).join("_");
  const base = mid ? `${prefix}_${mid}_${stamp}` : `${prefix}_${stamp}`;
  return `KingFish_${base}`;
}
