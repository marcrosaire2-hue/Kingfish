import * as XLSX from "xlsx-js-style";
import { APP_NAME } from "@/lib/brand";

export type ExcelCell = string | number | boolean | null | undefined;

export type ExcelSheet = {
  /** Nom d’onglet Excel (max 31 car.) */
  name: string;
  /** Lignes objets → colonnes = clés */
  rows: Record<string, ExcelCell>[];
  /** Sous-titre affiché sous le titre (période, point de vente…) */
  subtitle?: string;
  /**
   * Colonnes à totaliser en pied de tableau, par intitulé exact. Sans cela,
   * un tableau de montants oblige le lecteur à refaire la somme à la main.
   */
  totals?: string[];
};

/* Couleurs de la marque, reprises de l’interface. */
const BLEU = "004888";
const OR = "F0B018";
const GRIS_LIGNE = "F2F6FA";
const GRIS_TEXTE = "5A7A9A";
const BORDURE = "D5E0EC";

/** Colonnes monétaires : reconnues à leur intitulé, formatées en FCFA. */
const MONNAIE = /FCFA|montant|prix|co[ûu]t|total|ca\b|marge|charge|r[ée]sultat/i;

function safeSheetName(name: string): string {
  const cleaned = name.replace(/[\\/?*[\]:]/g, " ").trim() || "Feuille";
  return cleaned.slice(0, 31);
}

const bordureFine = {
  top: { style: "thin", color: { rgb: BORDURE } },
  bottom: { style: "thin", color: { rgb: BORDURE } },
  left: { style: "thin", color: { rgb: BORDURE } },
  right: { style: "thin", color: { rgb: BORDURE } },
} as const;

function styleTitre() {
  return {
    font: { bold: true, sz: 15, color: { rgb: BLEU } },
    alignment: { vertical: "center" as const },
  };
}

function styleSousTitre() {
  return {
    font: { sz: 10, color: { rgb: GRIS_TEXTE } },
    alignment: { vertical: "center" as const },
  };
}

function styleEntete() {
  return {
    font: { bold: true, sz: 11, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: BLEU } },
    alignment: {
      horizontal: "left" as const,
      vertical: "center" as const,
      wrapText: true,
    },
    border: bordureFine,
  };
}

function styleCellule(estNombre: boolean, ligneImpaire: boolean) {
  return {
    font: { sz: 10 },
    alignment: {
      horizontal: (estNombre ? "right" : "left") as "right" | "left",
      vertical: "center" as const,
    },
    fill: ligneImpaire ? { fgColor: { rgb: GRIS_LIGNE } } : undefined,
    border: bordureFine,
  };
}

function styleTotal(estNombre: boolean) {
  return {
    font: { bold: true, sz: 11, color: { rgb: BLEU } },
    fill: { fgColor: { rgb: OR } },
    alignment: {
      horizontal: (estNombre ? "right" : "left") as "right" | "left",
      vertical: "center" as const,
    },
    border: bordureFine,
  };
}

/** Largeur d’une colonne, calée sur le plus long contenu, bornée. */
function largeur(cle: string, valeurs: ExcelCell[]): number {
  const plusLong = valeurs.reduce<number>((max, v) => {
    const texte = v === null || v === undefined ? "" : String(v);
    return Math.max(max, texte.length);
  }, cle.length);
  return Math.min(46, Math.max(11, plusLong + 3));
}

function construireFeuille(sheet: ExcelSheet, titre: string): XLSX.WorkSheet {
  const rows =
    sheet.rows.length > 0
      ? sheet.rows
      : [{ Info: "Aucune ligne pour cette feuille" }];
  const colonnes = Object.keys(rows[0] ?? {});

  const totaux = new Map<string, number>();
  for (const nom of sheet.totals ?? []) {
    if (!colonnes.includes(nom)) continue;
    totaux.set(
      nom,
      rows.reduce((s, r) => s + (typeof r[nom] === "number" ? r[nom] : 0), 0),
    );
  }

  // Deux lignes d’en-tête de document, puis le tableau.
  const LIGNE_ENTETE = 2;
  const grille: ExcelCell[][] = [
    [titre],
    [sheet.subtitle ?? ""],
    colonnes,
    ...rows.map((r) => colonnes.map((c) => r[c] ?? "")),
  ];
  if (totaux.size > 0) {
    grille.push(
      colonnes.map((c, i) =>
        totaux.has(c) ? (totaux.get(c) as number) : i === 0 ? "TOTAL" : "",
      ),
    );
  }

  const ws = XLSX.utils.aoa_to_sheet(grille);
  const derniereLigne = grille.length - 1;

  ws["A1"]!.s = styleTitre();
  if (ws["A2"]) ws["A2"].s = styleSousTitre();

  for (let c = 0; c < colonnes.length; c += 1) {
    const nomColonne = colonnes[c]!;
    const estMonnaie = MONNAIE.test(nomColonne);

    const refEntete = XLSX.utils.encode_cell({ r: LIGNE_ENTETE, c });
    if (ws[refEntete]) ws[refEntete].s = styleEntete();

    for (let r = LIGNE_ENTETE + 1; r <= derniereLigne; r += 1) {
      const ref = XLSX.utils.encode_cell({ r, c });
      const cellule = ws[ref];
      if (!cellule) continue;
      const estNombre = typeof cellule.v === "number";
      const estTotal = totaux.size > 0 && r === derniereLigne;

      cellule.s = estTotal
        ? styleTotal(estNombre)
        : styleCellule(estNombre, (r - LIGNE_ENTETE) % 2 === 0);

      // Séparateur de milliers : un montant à six chiffres est illisible sans.
      if (estNombre && (estMonnaie || Math.abs(cellule.v as number) >= 1000)) {
        cellule.z = "# ##0";
      }
    }
  }

  ws["!cols"] = colonnes.map((cle) =>
    ({ wch: largeur(cle, rows.map((r) => r[cle])) }),
  );
  ws["!rows"] = [{ hpt: 24 }, { hpt: 16 }, { hpt: 22 }];
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(0, colonnes.length - 1) } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: Math.max(0, colonnes.length - 1) } },
  ];
  // Chaque colonne est filtrable et triable depuis l’en-tête. Le gel des
  // volets n’est pas écrit par la bibliothèque : vérifié, aucune des formes
  // (!freeze, !views, !panes) ne produit d’élément <pane>.
  ws["!autofilter"] = {
    ref: `${XLSX.utils.encode_cell({ r: LIGNE_ENTETE, c: 0 })}:${XLSX.utils.encode_cell(
      { r: derniereLigne, c: Math.max(0, colonnes.length - 1) },
    )}`,
  };

  return ws;
}

/**
 * Construit le classeur. Séparé du téléchargement pour être vérifiable :
 * c'est ici que se joue la mise en forme, et un test peut l'inspecter sans
 * navigateur.
 */
export function buildWorkbook(
  sheets: ExcelSheet[],
  options?: { title?: string; subtitle?: string },
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const list = sheets.length
    ? sheets
    : [{ name: "Vide", rows: [{ Info: "Aucune donnée" }] }];

  const editeLe = new Date().toLocaleString("fr-FR");

  for (const sheet of list) {
    const titre = options?.title
      ? `${options.title} — ${sheet.name}`
      : `${APP_NAME} — ${sheet.name}`;
    const sousTitre =
      sheet.subtitle ?? options?.subtitle ?? `Édité le ${editeLe}`;
    wb.Props = {
      Title: options?.title ?? APP_NAME,
      Company: APP_NAME,
      CreatedDate: new Date(),
    };
    XLSX.utils.book_append_sheet(
      wb,
      construireFeuille({ ...sheet, subtitle: sousTitre }, titre),
      safeSheetName(sheet.name),
    );
  }

  return wb;
}

/** Télécharge un fichier .xlsx multi-feuilles dans le navigateur. */
export function downloadExcel(
  filename: string,
  sheets: ExcelSheet[],
  options?: { title?: string; subtitle?: string },
): void {
  if (typeof window === "undefined") {
    throw new Error("Export Excel disponible uniquement dans le navigateur");
  }
  const base = filename.replace(/\.xlsx$/i, "");
  XLSX.writeFile(buildWorkbook(sheets, options), `${base}.xlsx`);
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
