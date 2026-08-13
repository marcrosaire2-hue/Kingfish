import { describe, expect, it } from "vitest";
import { assertDayOpen } from "@/lib/day-doc";

describe("assertDayOpen", () => {
  it("refuse une écriture sur une journée clôturée", () => {
    expect(() => assertDayOpen("cloturee")).toThrow(
      "Journée clôturée : modification impossible.",
    );
  });

  it("porte le message spécifique au contexte appelant", () => {
    expect(() => assertDayOpen("cloturee", "Journée clôturée : perte impossible.")).toThrow(
      "Journée clôturée : perte impossible.",
    );
  });

  it("laisse passer une journée ouverte", () => {
    expect(() => assertDayOpen("ouverte")).not.toThrow();
  });

  it("laisse passer un statut absent (jour jamais créé)", () => {
    expect(() => assertDayOpen(null)).not.toThrow();
    expect(() => assertDayOpen(undefined)).not.toThrow();
  });
});
