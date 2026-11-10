import { describe, expect, it } from "vitest";
import {
  mapAchatCorrectionToStockEvents,
  mapAchatToStockEvents,
  mapComptageToStockEvent,
  mapPerteToStockEvents,
  mapVenteToStockEvents,
} from "@/lib/stock-ledger-map";
import { listStockBalances } from "@/lib/stock-ledger";

const vente = {
  id: "v1",
  date: "2026-11-10",
  site: "zogbo" as const,
  kind: "plat" as const,
  productId: "poulet",
  name: "Poulet",
  qty: 3,
  at: "2026-11-10T12:00:00.000Z",
  cancelledAt: null,
  source: "caisse",
  actorId: "u1",
};

describe("traduction en événements de stock", () => {
  it("une vente sort du stock", () => {
    const [event] = mapVenteToStockEvents(vente);
    expect(event!.type).toBe("vente");
    expect(event!.qty).toBe(3);
    expect(event!.family).toBe("plat");
    expect(event!.idempotencyKey).toBe("vente:v1");
  });

  it("une vente annulée produit une sortie + une reprise", () => {
    const events = mapVenteToStockEvents({
      ...vente,
      cancelledAt: "2026-11-10T13:00:00.000Z",
    });
    expect(events).toHaveLength(2);
    const [balance] = listStockBalances([
      ...events,
      mapAchatToStockEvents({
        id: "a1",
        date: vente.date,
        site: vente.site,
        family: "plat",
        productId: vente.productId,
        name: vente.name,
        qty: 10,
        at: "2026-11-10T08:00:00.000Z",
      })[0]!,
    ]);
    expect(balance!.stock).toBe(10);
    expect(balance!.ventes).toBe(3);
    expect(balance!.annulations).toBe(3);
  });

  it("une quantité négative est une correction de vente", () => {
    const [event] = mapVenteToStockEvents({ ...vente, qty: -2 });
    expect(event!.type).toBe("annulation");
    expect(event!.qty).toBe(2);
  });

  it("les ventes sans stock (extra, combo) sont ignorées", () => {
    expect(mapVenteToStockEvents({ ...vente, kind: "extra" })).toEqual([]);
    expect(mapVenteToStockEvents({ ...vente, kind: "combo" })).toEqual([]);
    expect(mapVenteToStockEvents({ ...vente, qty: 0 })).toEqual([]);
  });

  it("une perte sort du stock, son annulation le restitue", () => {
    const perte = {
      id: "p1",
      date: "2026-11-10",
      site: "gbegamey" as const,
      kind: "boisson",
      productId: "coca",
      name: "Coca",
      qty: 2,
      at: "2026-11-10T10:00:00.000Z",
      cancelledAt: "2026-11-10T11:00:00.000Z",
    };
    const events = [
      ...mapAchatToStockEvents({
        id: "a1",
        date: perte.date,
        site: perte.site,
        family: "boisson",
        productId: perte.productId,
        name: perte.name,
        qty: 6,
        at: "2026-11-10T08:00:00.000Z",
      }),
      ...mapPerteToStockEvents(perte),
    ];
    const [balance] = listStockBalances(events);
    expect(balance!.stock).toBe(6);
    expect(balance!.pertes).toBe(2);
    expect(balance!.annulations).toBe(2);
  });

  it("un achat annulé ne laisse aucun stock", () => {
    const events = mapAchatToStockEvents({
      id: "a1",
      date: "2026-11-10",
      site: "zogbo",
      family: "matiere",
      productId: "riz",
      name: "Riz",
      qty: 5,
      at: "2026-11-10T08:00:00.000Z",
      cancelledAt: "2026-11-10T09:00:00.000Z",
    });
    const [balance] = listStockBalances(events);
    expect(balance!.stock).toBe(0);
    expect(balance!.entrees).toBe(0);
  });

  it("une correction d'achat n'applique que l'écart", () => {
    const achat = {
      id: "a1",
      date: "2026-11-10",
      site: "zogbo" as const,
      family: "matiere" as const,
      productId: "riz",
      name: "Riz",
    };
    const entree = mapAchatToStockEvents({
      ...achat,
      qty: 5,
      at: "2026-11-10T08:00:00.000Z",
    });
    const baisse = mapAchatCorrectionToStockEvents({
      ...achat,
      qtyAvant: 5,
      qtyApres: 3,
      editedAt: "2026-11-10T09:00:00.000Z",
    });
    const hausse = mapAchatCorrectionToStockEvents({
      ...achat,
      qtyAvant: 3,
      qtyApres: 7,
      editedAt: "2026-11-10T10:00:00.000Z",
    });
    expect(listStockBalances([...entree, ...baisse])[0]!.stock).toBe(3);
    expect(listStockBalances([...entree, ...baisse, ...hausse])[0]!.stock).toBe(7);
    expect(
      mapAchatCorrectionToStockEvents({
        ...achat,
        qtyAvant: 5,
        qtyApres: 5,
        editedAt: "2026-11-10T11:00:00.000Z",
      }),
    ).toEqual([]);
  });

  it("ignore les pertes sans ligne de stock suivie", () => {
    expect(
      mapPerteToStockEvents({
        id: "p2",
        date: "2026-11-10",
        site: "zogbo",
        kind: "immobilisation",
        productId: "emb",
        name: "Emballage",
        qty: 1,
        at: "2026-11-10T10:00:00.000Z",
      }),
    ).toEqual([]);
  });

  it("un comptage écrit le stock et fige l'écart", () => {
    const events = [
      ...mapAchatToStockEvents({
        id: "a1",
        date: "2026-11-10",
        site: "zogbo",
        family: "boisson",
        productId: "coca",
        name: "Coca",
        qty: 12,
        at: "2026-11-10T08:00:00.000Z",
      }),
      ...mapVenteToStockEvents({
        ...vente,
        kind: "boisson",
        productId: "coca",
        name: "Coca",
        qty: 4,
      }),
      mapComptageToStockEvent({
        site: "zogbo",
        family: "boisson",
        productId: "coca",
        name: "Coca",
        qty: 7,
        at: "2026-11-10T18:00:00.000Z",
        date: "2026-11-10",
        reference: "2026-11-10T18:00",
      }),
    ];
    const [balance] = listStockBalances(events);
    expect(balance!.stock).toBe(7);
    expect(balance!.lastEcart).toBe(-1);
    expect(balance!.lastCounted).toBe(7);
    expect(balance!.unit).toBe("bt");
  });
});
