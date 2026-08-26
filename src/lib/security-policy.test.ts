import { describe, expect, it } from "vitest";
import { canManagePastVentes } from "@/lib/auth-types";
import {
  authorizeClosedDayWrite,
  authorizeDestructiveSale,
  authorizeRequestedSite,
  canCorrectClosedFinancialData,
  canPurgeFinancialData,
  containsMongoOperator,
  hasProtectedMassAssignment,
  isValidAuditReason,
  parseFiniteAmount,
  shouldRevokeSessions,
} from "@/lib/security-policy";

describe("matrice d'autorisations financières", () => {
  it("autorise le gérant à corriger un jour ouvert, pas à purger", () => {
    expect(canManagePastVentes("gerant")).toBe(true);
    expect(canPurgeFinancialData("gerant")).toBe(false);
    expect(canCorrectClosedFinancialData("gerant")).toBe(false);
  });

  it("interdit au comptable de purger ou de forcer un jour clos", () => {
    expect(canManagePastVentes("comptable")).toBe(true);
    expect(canPurgeFinancialData("comptable")).toBe(false);
    expect(canCorrectClosedFinancialData("comptable")).toBe(false);
  });

  it("permet au DAF de corriger un jour clos, pas de purger", () => {
    expect(canCorrectClosedFinancialData("daf")).toBe(true);
    expect(canPurgeFinancialData("daf")).toBe(false);
  });

  it("réserve la purge à l'administrateur", () => {
    expect(canPurgeFinancialData("admin")).toBe(true);
    expect(canCorrectClosedFinancialData("admin")).toBe(true);
  });
});

describe("IDOR de site", () => {
  it("force la zone du compte même si le client demande l'autre site", () => {
    // Anti-IDOR sans casser l'UI : on n'écrit jamais sur l'autre zone.
    expect(authorizeRequestedSite("zogbo", "gbegamey")).toEqual({
      ok: true,
      site: "zogbo",
    });
    expect(authorizeRequestedSite("gbegamey", "zogbo")).toEqual({
      ok: true,
      site: "gbegamey",
    });
  });

  it("ignore un site omis et reste sur la zone du compte", () => {
    expect(authorizeRequestedSite("zogbo", null)).toEqual({
      ok: true,
      site: "zogbo",
    });
    expect(authorizeRequestedSite("gbegamey", undefined)).toEqual({
      ok: true,
      site: "gbegamey",
    });
  });

  it("autorise un admin multi-sites à choisir une zone", () => {
    expect(authorizeRequestedSite("tous", "gbegamey")).toEqual({
      ok: true,
      site: "gbegamey",
    });
  });

  it("par défaut place un compte multi-sites sur Zogbo", () => {
    expect(authorizeRequestedSite("tous", null)).toEqual({
      ok: true,
      site: "zogbo",
    });
  });

  it("rejette un opérateur Mongo passé comme site", () => {
    const r = authorizeRequestedSite("tous", { $ne: "zogbo" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("rejette un opérateur Mongo même pour un compte de zone", () => {
    const r = authorizeRequestedSite("zogbo", { $ne: "gbegamey" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });
});

describe("purge et suppression définitive", () => {
  it("bloque un gérant sur action=purge", () => {
    const r = authorizeDestructiveSale({
      role: "gerant",
      action: "purge",
      reason: "correction historique demandée",
      confirm: true,
    });
    expect(r).toEqual({
      ok: false,
      status: 403,
      error: "Purge définitive réservée à l'administrateur.",
    });
  });

  it("bloque un gérant sur action=delete", () => {
    const r = authorizeDestructiveSale({
      role: "gerant",
      action: "delete",
      reason: "doublon de caisse",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });

  it("exige un motif et une confirmation pour la purge admin", () => {
    expect(
      authorizeDestructiveSale({
        role: "admin",
        action: "purge",
        reason: "ok",
        confirm: true,
      }).ok,
    ).toBe(false);
    expect(
      authorizeDestructiveSale({
        role: "admin",
        action: "purge",
        reason: "reprise de saisie erronée",
        confirm: false,
      }).ok,
    ).toBe(false);
    expect(
      authorizeDestructiveSale({
        role: "admin",
        action: "purge",
        reason: "reprise de saisie erronée",
        confirm: true,
      }),
    ).toEqual({ ok: true });
  });
});

describe("protection des jours clôturés", () => {
  it("interdit au gérant de contourner un jour clos", () => {
    const r = authorizeClosedDayWrite({ role: "gerant", closedDay: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });

  it("laisse le gérant écrire sur un jour ouvert", () => {
    expect(
      authorizeClosedDayWrite({ role: "gerant", closedDay: false }),
    ).toEqual({ ok: true });
  });

  it("autorise DAF et admin sur un jour clos", () => {
    expect(authorizeClosedDayWrite({ role: "daf", closedDay: true })).toEqual({
      ok: true,
    });
    expect(authorizeClosedDayWrite({ role: "admin", closedDay: true })).toEqual(
      { ok: true },
    );
  });
});

describe("révocation de session", () => {
  it("révoque après un changement de rôle sans mot de passe", () => {
    expect(
      shouldRevokeSessions({
        roleChanged: true,
        siteChanged: false,
        shiftChanged: false,
        activeChanged: false,
        passwordChanged: false,
      }),
    ).toBe(true);
  });

  it("révoque après un changement de site", () => {
    expect(
      shouldRevokeSessions({
        roleChanged: false,
        siteChanged: true,
        shiftChanged: false,
        activeChanged: false,
        passwordChanged: false,
      }),
    ).toBe(true);
  });

  it("révoque après désactivation", () => {
    expect(
      shouldRevokeSessions({
        roleChanged: false,
        siteChanged: false,
        shiftChanged: false,
        activeChanged: true,
        passwordChanged: false,
      }),
    ).toBe(true);
  });

  it("ne révoque pas pour un simple changement de nom", () => {
    expect(
      shouldRevokeSessions({
        roleChanged: false,
        siteChanged: false,
        shiftChanged: false,
        activeChanged: false,
        passwordChanged: false,
      }),
    ).toBe(false);
  });
});

describe("validation d'entrée", () => {
  it("détecte une injection d'opérateur Mongo", () => {
    expect(containsMongoOperator({ site: { $ne: "zogbo" } })).toBe(true);
    expect(containsMongoOperator({ $gt: 0 })).toBe(true);
    expect(containsMongoOperator({ site: "zogbo", qty: 2 })).toBe(false);
  });

  it("refuse un mass-assignment de champs protégés", () => {
    expect(hasProtectedMassAssignment({ costPrice: 1, qty: 2 })).toBe(true);
    expect(hasProtectedMassAssignment({ cancelledAt: "x" })).toBe(true);
    expect(hasProtectedMassAssignment({ qty: 2, unitPrice: 500 })).toBe(
      false,
    );
  });

  it("rejette NaN, Infinity et les montants négatifs", () => {
    expect(parseFiniteAmount(Number.NaN)).toBeNull();
    expect(parseFiniteAmount(Number.POSITIVE_INFINITY)).toBeNull();
    expect(parseFiniteAmount(-10)).toBeNull();
    expect(parseFiniteAmount({ $gt: 0 })).toBeNull();
    expect(parseFiniteAmount(1500)).toBe(1500);
  });

  it("exige un motif d'audit suffisamment précis", () => {
    expect(isValidAuditReason("abc")).toBe(false);
    expect(isValidAuditReason("doublon caisse du 12")).toBe(true);
  });
});
