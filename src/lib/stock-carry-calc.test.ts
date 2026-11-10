import { describe, expect, it } from "vitest";
import { applyOpeningCarry, leftoverDelta } from "@/lib/stock-carry-calc";
import { leftoverFromZogboLines } from "@/lib/zogbo-calc";
import { leftoverFromLocalLines } from "@/lib/gbegamey-calc";
import type { GbegameyLocalLine, ZogboLine } from "@/lib/types";

function plat(patch: Partial<ZogboLine> = {}): ZogboLine {
  return {
    productId: "base-tilapia",
    name: "Tilapia",
    stock: 10,
    prepared: 0,
    sentToGbegamey: 0,
    sold: 0,
    pertes: 0,
    counted: null,
    observations: "",
    ...patch,
  };
}

function acc(patch: Partial<GbegameyLocalLine> = {}): GbegameyLocalLine {
  return {
    productId: "local-riz",
    name: "Riz",
    initialStock: 15,
    prepared: 0,
    sold: 0,
    pertes: 0,
    counted: null,
    observations: "",
    ...patch,
  };
}

describe("report des plats sur les jours suivants", () => {
  it("une vente de plat saisie en retard réduit l'ouverture du lendemain", () => {
    const avant = leftoverFromZogboLines([plat()]);
    const apres = leftoverFromZogboLines([plat({ sold: 3 })]);
    const delta = leftoverDelta(avant, apres);
    expect(delta.get("base-tilapia")).toBe(-3);

    // Lendemain ouvert avec l'ancien reste (10), déjà 2 vendus.
    const { lines, next, changed } = applyOpeningCarry(
      [plat({ stock: 10, sold: 2 })],
      delta,
      "stock",
    );
    expect(changed).toBe(true);
    expect(lines[0]!.stock).toBe(7);
    expect(lines[0]!.sold).toBe(2);
    expect(next.get("base-tilapia")).toBe(-3);
  });

  it("une perte annulée sur un accompagnement remonte l'ouverture", () => {
    const avant = leftoverFromLocalLines([acc({ pertes: 4 })]);
    const apres = leftoverFromLocalLines([acc()]);
    const delta = leftoverDelta(avant, apres);
    expect(delta.get("local-riz")).toBe(4);
    const { lines } = applyOpeningCarry(
      [acc({ initialStock: 11 })],
      delta,
      "initialStock",
    );
    expect(lines[0]!.initialStock).toBe(15);
  });

  it("s'arrête au jour qui porte un comptage", () => {
    const delta = new Map([["base-tilapia", -2]]);
    const { lines, next } = applyOpeningCarry(
      [plat({ stock: 8, counted: 5 })],
      delta,
      "stock",
    );
    expect(lines[0]!.stock).toBe(6);
    expect(next.has("base-tilapia")).toBe(false);
  });

  it("conserve le négatif et ignore les autres produits", () => {
    const delta = new Map([["base-tilapia", -20]]);
    const { lines } = applyOpeningCarry(
      [plat({ stock: 5 }), plat({ productId: "base-autre", stock: 4 })],
      delta,
      "stock",
    );
    expect(lines[0]!.stock).toBe(-15);
    expect(lines[1]!.stock).toBe(4);
  });

  it("un comptage sur le jour modifié change aussi le report", () => {
    const avant = leftoverFromZogboLines([plat({ sold: 2 })]);
    const apres = leftoverFromZogboLines([plat({ sold: 2, counted: 6 })]);
    expect(leftoverDelta(avant, apres).get("base-tilapia")).toBe(-2);
  });

  it("aucun écart : rien ne change", () => {
    const l = leftoverFromZogboLines([plat()]);
    const { changed } = applyOpeningCarry([plat()], leftoverDelta(l, l), "stock");
    expect(changed).toBe(false);
  });
});
