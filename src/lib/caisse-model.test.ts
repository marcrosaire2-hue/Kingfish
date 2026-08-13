import { describe, expect, it } from "vitest";
import {
  allowedCaisses,
  caisseForSite,
  caisseZone,
  canUseCaisse,
  defaultCaisse,
  soldeTheorique,
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

  it("compte les versements au solde, dans les deux sens", () => {
    const zone = session({ totalVente: 50_000, totalVersementSorti: 40_000 });
    expect(soldeTheorique(zone)).toBe(20_000);

    const coffre = session({
      caisse: "centrale",
      site: null,
      soldeInitial: 0,
      totalVersementRecu: 40_000,
    });
    expect(soldeTheorique(coffre)).toBe(40_000);
  });

  it("tolère une session écrite avant les versements", () => {
    const ancienne = session({
      totalVente: 5_000,
      totalVersementSorti: undefined as unknown as number,
      totalVersementRecu: undefined as unknown as number,
    });
    expect(soldeTheorique(ancienne)).toBe(15_000);
  });

  it("l'annulation d'une dépense ramène le théorique à l'état d'avant (T9)", () => {
    // cancelCaisseMouvement décremente totalDepense du montant annulé : le
    // théorique doit donc retrouver exactement sa valeur d'avant la dépense.
    const avant = session({ totalVente: 50_000, totalDepense: 0 });
    const apresDepense = session({ totalVente: 50_000, totalDepense: 7_000 });
    const apresAnnulation = session({ totalVente: 50_000, totalDepense: 0 });
    expect(soldeTheorique(apresDepense)).toBe(soldeTheorique(avant) - 7_000);
    expect(soldeTheorique(apresAnnulation)).toBe(soldeTheorique(avant));
  });

  it("l'annulation d'une recette retire ce qu'elle avait ajouté (T9)", () => {
    const avant = session({ totalVente: 50_000, totalRecette: 0 });
    const apresRecette = session({ totalVente: 50_000, totalRecette: 3_000 });
    const apresAnnulation = session({ totalVente: 50_000, totalRecette: 0 });
    expect(soldeTheorique(apresRecette)).toBe(soldeTheorique(avant) + 3_000);
    expect(soldeTheorique(apresAnnulation)).toBe(soldeTheorique(avant));
  });
});

describe("accès aux caisses", () => {
  it("réserve le coffre central à l'administrateur global", () => {
    expect(canUseCaisse({ role: "vendeur", site: "tous" }, "centrale")).toBe(false);
    expect(canUseCaisse({ role: "equipier", site: "zogbo" }, "centrale")).toBe(false);
    expect(canUseCaisse({ role: "gerant", site: "zogbo" }, "centrale")).toBe(false);
    expect(canUseCaisse({ role: "admin", site: "tous" }, "centrale")).toBe(true);
    expect(canUseCaisse({ role: "admin", site: "zogbo" }, "centrale")).toBe(false);
  });

  it("limite un compte de zone à la caisse de sa zone", () => {
    const vendeur = { role: "vendeur", site: "zogbo" } as const;
    expect(canUseCaisse(vendeur, "zogbo")).toBe(true);
    expect(canUseCaisse(vendeur, "gbegamey")).toBe(false);
    expect(allowedCaisses(vendeur)).toEqual(["zogbo"]);
  });

  it("ouvre les trois caisses à l'administrateur global", () => {
    expect(allowedCaisses({ role: "admin", site: "tous" })).toEqual([
      "centrale",
      "zogbo",
      "gbegamey",
    ]);
  });

  it("arrive sur sa zone, ou sur le coffre pour un compte multi-sites", () => {
    expect(defaultCaisse({ role: "vendeur", site: "gbegamey" })).toBe("gbegamey");
    expect(defaultCaisse({ role: "admin", site: "tous" })).toBe("centrale");
    expect(defaultCaisse({ role: "vendeur", site: "tous" })).toBe("gbegamey");
    expect(defaultCaisse({ role: "gerant", site: "zogbo" })).toBe("zogbo");
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
