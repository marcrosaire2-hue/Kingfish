import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx-js-style";
import {
  buildWorkbook,
  compareIsoChronological,
  excelFilename,
  sortChronologically,
  sortChronologicallyBy,
} from "@/lib/export-excel";

type Cellule = { v?: unknown; s?: Record<string, unknown>; z?: string };

function feuille(nom = "Ventes") {
  return {
    name: nom,
    subtitle: "Gbégamey · 2026-08-12",
    totals: ["Qté", "Montant (FCFA)"],
    rows: [
      { Produit: "POISSON BRAISÉ", Qté: 12, "Montant (FCFA)": 36000 },
      { Produit: "ATTIÉKÉ", Qté: 5, "Montant (FCFA)": 7500 },
    ],
  };
}

function cellule(ws: XLSX.WorkSheet, ref: string): Cellule | undefined {
  return ws[ref] as Cellule | undefined;
}

describe("mise en forme du classeur", () => {
  it("place un titre et un sous-titre au-dessus du tableau", () => {
    const ws = buildWorkbook([feuille()]).Sheets["Ventes"]!;
    expect(String(cellule(ws, "A1")?.v)).toContain("Ventes");
    expect(cellule(ws, "A2")?.v).toBe("Gbégamey · 2026-08-12");
    // Le tableau commence en ligne 3, en-tête compris.
    expect(cellule(ws, "A3")?.v).toBe("Produit");
  });

  it("habille l'en-tête aux couleurs de la marque", () => {
    const ws = buildWorkbook([feuille()]).Sheets["Ventes"]!;
    const entete = cellule(ws, "A3")?.s as {
      font?: { bold?: boolean; color?: { rgb?: string } };
      fill?: { fgColor?: { rgb?: string } };
    };
    expect(entete?.font?.bold).toBe(true);
    expect(entete?.fill?.fgColor?.rgb).toBe("004888");
    expect(entete?.font?.color?.rgb).toBe("FFFFFF");
  });

  it("ajoute une ligne de total sur les colonnes demandées", () => {
    const ws = buildWorkbook([feuille()]).Sheets["Ventes"]!;
    // 2 lignes de données → le total est en ligne 6.
    expect(cellule(ws, "A6")?.v).toBe("TOTAL");
    expect(cellule(ws, "B6")?.v).toBe(17);
    expect(cellule(ws, "C6")?.v).toBe(43500);
  });

  it("met le total en évidence", () => {
    const ws = buildWorkbook([feuille()]).Sheets["Ventes"]!;
    const style = cellule(ws, "C6")?.s as {
      font?: { bold?: boolean };
      fill?: { fgColor?: { rgb?: string } };
    };
    expect(style?.font?.bold).toBe(true);
    expect(style?.fill?.fgColor?.rgb).toBe("F0B018");
  });

  it("sépare les milliers sur les montants", () => {
    const ws = buildWorkbook([feuille()]).Sheets["Ventes"]!;
    // 36000 sans séparateur est illisible d'un coup d'œil.
    expect(cellule(ws, "C4")?.z).toBe("# ##0");
    // Une petite quantité n'a pas besoin de format.
    expect(cellule(ws, "B5")?.z).toBeUndefined();
  });

  it("aligne les nombres à droite et le texte à gauche", () => {
    const ws = buildWorkbook([feuille()]).Sheets["Ventes"]!;
    const texte = cellule(ws, "A4")?.s as {
      alignment?: { horizontal?: string };
    };
    const nombre = cellule(ws, "C4")?.s as {
      alignment?: { horizontal?: string };
    };
    expect(texte?.alignment?.horizontal).toBe("left");
    expect(nombre?.alignment?.horizontal).toBe("right");
  });

  it("dimensionne les colonnes sur leur contenu réel", () => {
    const ws = buildWorkbook([feuille()]).Sheets["Ventes"]!;
    const cols = ws["!cols"] as { wch: number }[];
    // « POISSON BRAISÉ » est plus long que l'intitulé « Produit ».
    expect(cols[0]!.wch).toBeGreaterThan("Produit".length + 3);
    expect(cols[0]!.wch).toBeLessThanOrEqual(46);
  });

  it("rend chaque colonne filtrable depuis l'en-tête", () => {
    const ws = buildWorkbook([feuille()]).Sheets["Ventes"]!;
    expect((ws["!autofilter"] as { ref: string }).ref).toBe("A3:C6");
  });

  it("fusionne le bandeau de titre sur toute la largeur", () => {
    const ws = buildWorkbook([feuille()]).Sheets["Ventes"]!;
    const merges = ws["!merges"] as { s: { c: number }; e: { c: number } }[];
    expect(merges[0]!.e.c).toBe(2);
  });
});

describe("robustesse", () => {
  it("produit une feuille lisible même sans aucune donnée", () => {
    const wb = buildWorkbook([{ name: "Vide", rows: [] }]);
    const ws = wb.Sheets["Vide"]!;
    expect(String(cellule(ws, "A4")?.v)).toContain("Aucune ligne");
  });

  it("n'ajoute pas de total quand aucune colonne n'est demandée", () => {
    const ws = buildWorkbook([
      { name: "S", rows: [{ Produit: "X", Qté: 2 }] },
    ]).Sheets["S"]!;
    expect(cellule(ws, "A5")).toBeUndefined();
  });

  it("ignore une colonne à totaliser qui n'existe pas", () => {
    const ws = buildWorkbook([
      { name: "S", rows: [{ Produit: "X" }], totals: ["Inconnue"] },
    ]).Sheets["S"]!;
    expect(cellule(ws, "A5")).toBeUndefined();
  });

  it("tronque et assainit un nom d'onglet interdit par Excel", () => {
    const wb = buildWorkbook([
      { name: "Ventes/2026:[août]", rows: [{ A: 1 }] },
    ]);
    const nom = wb.SheetNames[0]!;
    expect(nom.length).toBeLessThanOrEqual(31);
    expect(nom).not.toMatch(/[\\/?*[\]:]/);
  });

  it("le fichier produit s'ouvre et se relit", () => {
    const buf = XLSX.write(buildWorkbook([feuille()]), {
      type: "buffer",
      bookType: "xlsx",
    }) as Buffer;
    const relu = XLSX.read(buf, { type: "buffer" });
    expect(relu.SheetNames).toContain("Ventes");
  });
});

describe("tri chronologique", () => {
  it("compare les dates ISO en ordre croissant", () => {
    expect(compareIsoChronological("2026-08-01", "2026-08-15")).toBeLessThan(0);
    expect(compareIsoChronological("2026-08-15", "2026-08-01")).toBeGreaterThan(0);
    expect(compareIsoChronological("2026-08-15", "2026-08-15")).toBe(0);
  });

  it("trie un tableau par date", () => {
    const rows = [
      { date: "2026-08-20", v: 3 },
      { date: "2026-08-01", v: 1 },
      { date: "2026-08-10", v: 2 },
    ];
    expect(sortChronologically(rows, (r) => r.date).map((r) => r.v)).toEqual([
      1, 2, 3,
    ]);
  });

  it("trie sur plusieurs clés (date puis heure)", () => {
    const rows = [
      { date: "2026-08-10", at: "2026-08-10T14:00:00Z", v: 2 },
      { date: "2026-08-10", at: "2026-08-10T09:00:00Z", v: 1 },
      { date: "2026-08-11", at: "2026-08-11T08:00:00Z", v: 3 },
    ];
    expect(
      sortChronologicallyBy(
        rows,
        (r) => r.date,
        (r) => r.at,
      ).map((r) => r.v),
    ).toEqual([1, 2, 3]);
  });
});

describe("dates Excel", () => {
  it("convertit les colonnes Date en type date Excel", () => {
    const ws = buildWorkbook([
      {
        name: "Journal",
        rows: [
          { Date: "2026-08-12", Montant: 1000 },
          { Date: "2026-08-01", Montant: 500 },
        ],
      },
    ]).Sheets["Journal"]!;
    // Ligne 4 = première donnée (ligne 3 = en-tête)
    expect(cellule(ws, "A4")?.t).toBe("n");
    expect(cellule(ws, "A4")?.z).toBe("dd/mm/yyyy");
    expect(typeof cellule(ws, "A4")?.v).toBe("number");
  });

  it("formate Quand avec heure si présente", () => {
    const ws = buildWorkbook([
      {
        name: "Registre",
        rows: [{ Quand: "2026-08-12T14:30:00Z", Titre: "Test" }],
      },
    ]).Sheets["Registre"]!;
    expect(cellule(ws, "A4")?.t).toBe("n");
    expect(cellule(ws, "A4")?.z).toMatch(/dd\/mm\/yyyy/);
  });
});

describe("excelFilename", () => {
  it("préfixe la marque et horodate", () => {
    const nom = excelFilename("ventes", "gbegamey");
    expect(nom).toMatch(/^KingFish_ventes_gbegamey_\d{4}-\d{2}-\d{2}/);
  });

  it("ignore les fragments vides", () => {
    expect(excelFilename("ventes", null, undefined)).toMatch(
      /^KingFish_ventes_\d{4}/,
    );
  });
});
