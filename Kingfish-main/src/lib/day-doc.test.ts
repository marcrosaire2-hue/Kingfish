import { describe, expect, it } from "vitest";
import { assertDayOpen, isValidDate } from "@/lib/day-doc";

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

  it("bypass autorise une journée clôturée (correction gérant)", () => {
    expect(() =>
      assertDayOpen("cloturee", "bloqué", { bypass: true }),
    ).not.toThrow();
  });
});

describe("isValidDate", () => {
  it("accepte une date calendaire réelle", () => {
    expect(isValidDate("2026-02-28")).toBe(true);
    expect(isValidDate("2024-02-29")).toBe(true); // bissextile
    expect(isValidDate("2026-12-31")).toBe(true);
  });

  it("refuse un format invalide", () => {
    expect(isValidDate("")).toBe(false);
    expect(isValidDate("2026-2-1")).toBe(false);
    expect(isValidDate("26-02-01")).toBe(false);
    // Injection d'opérateurs MongoDB : la date alimente des _id de documents.
    expect(isValidDate('{"$gt":""}')).toBe(false);
  });

  it("refuse une date bien formée mais inexistante", () => {
    expect(isValidDate("2025-02-29")).toBe(false); // non bissextile
    expect(isValidDate("2026-02-30")).toBe(false);
    expect(isValidDate("2026-04-31")).toBe(false);
    expect(isValidDate("2026-13-01")).toBe(false);
    expect(isValidDate("2026-00-10")).toBe(false);
    expect(isValidDate("2026-01-00")).toBe(false);
  });
});
