import { describe, expect, it } from "vitest";
import { deplacerA } from "@/lib/catalogue-ordre";

const liste = ["a", "b", "c", "d"].map((id) => ({ id }));
const ids = (rows: { id: string }[]) => rows.map((r) => r.id).join("");

describe("deplacerA", () => {
  it("remonte un produit en tête", () => {
    expect(ids(deplacerA(liste, "c", 1))).toBe("cabd");
  });

  it("descend un produit tout en bas", () => {
    expect(ids(deplacerA(liste, "a", 4))).toBe("bcda");
  });

  it("borne un numéro trop grand ou trop petit", () => {
    expect(ids(deplacerA(liste, "b", 99))).toBe("acdb");
    expect(ids(deplacerA(liste, "d", 0))).toBe("dabc");
  });

  it("ignore un produit inconnu ou un numéro invalide", () => {
    expect(ids(deplacerA(liste, "z", 1))).toBe("abcd");
    expect(ids(deplacerA(liste, "b", Number.NaN))).toBe("abcd");
  });

  it("ne modifie pas la liste d'origine", () => {
    deplacerA(liste, "d", 1);
    expect(ids(liste)).toBe("abcd");
  });
});
