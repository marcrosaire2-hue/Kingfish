import { describe, expect, it } from "vitest";
import {
  allowedCaisses,
  assertIndependentCaisseTransfer,
  caisseForSite,
  caisseZone,
  canUseCaisse,
  defaultCaisse,
  soldeTheorique,
  ZONE_CAISSES,
} from "@/lib/caisse-model";
import type { CaisseSession } from "@/lib/types";

function session(partial: Partial<CaisseSession> = {}): CaisseSession {
  return {
    id: "s1",
    caisse: "zogbo",
    date: "2026-08-12",
    site: "zogbo",
    userId: "u1",
    userName: "Vendeur",
    statut: "ouverte",
    soldeInitial: 10_000,
    totalVente: 0,
    totalDepense: 0,
    totalRecette: 0,
    totalVersementSorti: 0,
    totalVersementRecu: 0,
    soldePhysique: null,
    soldeFermeture: null,
    commentaire: null,
    openedAt: "2026-08-12T07:00:00.000Z",
    closedAt: null,
    closedById: null,
    closedByName: null,
    updatedAt: null,
    ...partial,
  };
}

describe("solde théorique", () => {
  it("additionne ventes et recettes, retranche les dépenses", () => {
    const s = session({ totalVente: 50_000, totalRecette: 2_000, totalDepense: 7_000 });
    expect(soldeTheorique(s)).toBe(55_000);
  });

  it("compte les versements historiques au solde", () => {
    const zone = session({ totalVente: 50_000, totalVersementSorti: 40_000 });
    expect(soldeTheorique(zone)).toBe(20_000);
  });
});

describe("indépendance des caisses", () => {
  it("n'autorise plus la caisse centrale", () => {
    expect(canUseCaisse({ role: "admin", site: "tous" }, "centrale")).toBe(false);
    expect(canUseCaisse({ role: "daf", site: "tous" }, "centrale")).toBe(false);
    expect(canUseCaisse({ role: "gerant", site: "zogbo" }, "centrale")).toBe(false);
  });

  it("limite un compte de zone à sa propre caisse", () => {
    const gerant = { role: "gerant", site: "zogbo" } as const;
    expect(canUseCaisse(gerant, "zogbo")).toBe(true);
    expect(canUseCaisse(gerant, "gbegamey")).toBe(false);
    expect(allowedCaisses(gerant)).toEqual(["zogbo"]);
  });

  it("donne à l'admin uniquement les deux caisses de zone", () => {
    expect(allowedCaisses({ role: "admin", site: "tous" })).toEqual([
      "zogbo",
      "gbegamey",
    ]);
    expect(ZONE_CAISSES).toEqual(["zogbo", "gbegamey"]);
  });

  it("ouvre Zogbo par défaut pour un compte multi-sites", () => {
    expect(defaultCaisse({ role: "gerant", site: "gbegamey" })).toBe("gbegamey");
    expect(defaultCaisse({ role: "admin", site: "tous" })).toBe("zogbo");
    expect(defaultCaisse({ role: "comptable", site: "tous" })).toBe("zogbo");
  });

  it("interdit tout transfert entre caisses", () => {
    expect(() =>
      assertIndependentCaisseTransfer("zogbo", "gbegamey"),
    ).toThrow(/indépendantes/);
    expect(() =>
      assertIndependentCaisseTransfer("zogbo", "centrale"),
    ).toThrow(/indépendantes/);
  });
});

describe("correspondance zone ↔ caisse", () => {
  it("mappe une zone sur sa caisse et retour", () => {
    expect(caisseForSite("zogbo")).toBe("zogbo");
    expect(caisseZone("gbegamey")).toBe("gbegamey");
  });

  it("ne rattache la centrale à aucune zone", () => {
    expect(caisseZone("centrale")).toBeNull();
  });
});
