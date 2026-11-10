import { describe, expect, it } from "vitest";
import { poserComptage } from "@/lib/stock-comptage";
import {
  boissonsComptageEvents,
  comptageEventsFromLines,
} from "@/lib/stock-ledger-sync";
import type { ComptageRef } from "@/lib/stock-comptage";

const ref: ComptageRef = {
  theorique: 10,
  vendu: 2,
  pertes: 1,
  at: "2026-08-10T12:00:00.000Z",
};

describe("comptageEventsFromLines", () => {
  it("écrit le comptage avec son horodatage et un écart figé", () => {
    const [event] = comptageEventsFromLines({
      site: "zogbo",
      date: "2026-08-10",
      family: "plat",
      unit: "portion",
      lines: [{ productId: "p1", name: "Plat", counted: 7, comptage: ref }],
    });
    expect(event).toBeDefined();
    expect(event!.type).toBe("comptage");
    expect(event!.qty).toBe(7);
    expect(event!.at).toBe(ref.at);
    expect(event!.unit).toBe("portion");
    expect(event!.idempotencyKey).toContain("zogbo");
    expect(event!.idempotencyKey).toContain("p1");
    expect(event!.idempotencyKey).toContain(ref.at!);
  });

  it("ignore un comptage nul, absent ou sans horodatage", () => {
    const events = comptageEventsFromLines({
      site: "zogbo",
      date: "2026-08-10",
      family: "plat",
      unit: "portion",
      lines: [
        { productId: "a", name: "A", counted: null, comptage: ref },
        { productId: "b", name: "B", counted: 3, comptage: undefined },
        {
          productId: "c",
          name: "C",
          counted: 3,
          comptage: { theorique: 1, vendu: 0, pertes: 0 },
        },
        {
          productId: "d",
          name: "D",
          counted: 3,
          comptage: { theorique: 1, vendu: 0, pertes: 0, at: "pas-une-date" },
        },
      ],
    });
    expect(events).toHaveLength(0);
  });

  it("accepte un comptage à zéro : il vide le stock", () => {
    const [event] = comptageEventsFromLines({
      site: "gbegamey",
      date: "2026-08-10",
      family: "local",
      unit: "portion",
      lines: [
        {
          productId: "l1",
          name: "Local",
          counted: 0,
          comptage: ref,
        },
      ],
    });
    expect(event!.qty).toBe(0);
    expect(event!.type).toBe("comptage");
  });
});

describe("boissonsComptageEvents", () => {
  it("lit les bouteilles du site concerné uniquement", () => {
    const events = boissonsComptageEvents({
      site: "zogbo",
      date: "2026-08-10",
      lines: [
        {
          productId: "b1",
          name: "Boisson",
          countedZogbo: 24,
          countedGbegamey: 3,
          comptageZogbo: ref,
          comptageGbegamey: { ...ref, at: "2026-08-10T13:00:00.000Z" },
        },
      ],
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.qty).toBe(24);
    expect(events[0]!.unit).toBe("bt");
    expect(events[0]!.at).toBe(ref.at);
  });
});

describe("poserComptage", () => {
  it("horodate un nouveau comptage et conserve l'ancien si la valeur ne change pas", () => {
    const nouveau = poserComptage({
      ancienCompte: 5,
      ancienRef: ref,
      nouveauCompte: 8,
      etat: { theorique: 10, vendu: 0, pertes: 0 },
    });
    expect(nouveau?.at).toBeDefined();
    expect(nouveau?.at).not.toBe(ref.at);

    const inchange = poserComptage({
      ancienCompte: 8,
      ancienRef: nouveau,
      nouveauCompte: 8,
      etat: { theorique: 10, vendu: 0, pertes: 0 },
    });
    expect(inchange).toBe(nouveau);
  });
});
