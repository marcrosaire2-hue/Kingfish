import { describe, expect, it } from "vitest";
import { accompanimentAvailability } from "@/lib/vente-repo";
import { syncZogboAccompanimentLines } from "@/lib/zogbo-repo";

describe("Zogbo — ventes et stock des accompagnements", () => {
  it("un accompagnement préparé mais non « suivi » compte son vrai stock (pas 0)", () => {
    // Cas réel du 05/11 : Riz préparé 15, jamais marqué suivi.
    const dispo = accompanimentAvailability(
      {
        productId: "local-riz",
        name: "RIZ",
        initialStock: 0,
        prepared: 15,
        sold: 0,
        pertes: 0,
        counted: null,
        observations: "",
      },
      "zogbo",
    );
    expect(dispo.stockLeft).toBe(15);
    expect(dispo.maxSold).toBe(15);
  });

  it("le stock restant suit les ventes et les pertes", () => {
    const dispo = accompanimentAvailability(
      {
        productId: "local-riz",
        name: "RIZ",
        initialStock: 2,
        prepared: 10,
        sold: 5,
        pertes: 1,
        counted: null,
        observations: "",
      },
      "zogbo",
    );
    expect(dispo.stockLeft).toBe(6);
  });

  it("un produit renommé dans le catalogue apparaît sous son nouveau nom", () => {
    const lignes = syncZogboAccompanimentLines(
      [
        {
          productId: "local-placali",
          name: "PLACALI",
          initialStock: 3,
          prepared: 0,
          sold: 0,
          pertes: 0,
          counted: null,
          observations: "",
        },
      ],
      [
        { id: "local-placali", name: "ATCHIEKE", unitPrice: 500 },
        { id: "local-nouveau", name: "Nouvel accompagnement", unitPrice: 500 },
      ],
    );
    expect(lignes.map((l) => l.name)).toEqual(["ATCHIEKE", "Nouvel accompagnement"]);
    // Le stock du produit renommé est conservé.
    expect(lignes[0]!.initialStock).toBe(3);
  });
});
