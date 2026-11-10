import { describe, expect, it } from "vitest";
import { accompanimentBoardProduct } from "@/lib/vente-repo";
import { syncZogboAccompanimentLines } from "@/lib/zogbo-repo";

describe("Zogbo — ventes et stock des accompagnements", () => {
  it("un accompagnement à stock nul reste vendable (vente hors stock)", () => {
    const produit = accompanimentBoardProduct({
      dish: { id: "local-riz", name: "RIZ", unitPrice: 500 },
      line: { sold: 15 },
      qrRequired: false,
    });
    expect(produit.stockLeft).toBeNull();
    expect(produit.blockReason).toBeNull();
    expect(produit.soldToday).toBe(15);
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
