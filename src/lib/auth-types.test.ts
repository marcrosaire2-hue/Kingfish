import { describe, expect, it } from "vitest";
import {
  canAccessPath,
  canManagePastVentes,
  defaultSiteForRole,
  effectiveSite,
  navForUser,
  sitesForRole,
} from "@/lib/auth-types";

describe("rôle Comptable", () => {
  it("ouvre la finance et la saisie stock par zone, sans vente ni Équipe", () => {
    const menu = navForUser("comptable", "tous");
    expect(menu).toEqual([
      "synthese",
      "compte-resultat",
      "comptabilite",
      "caisse",
      "zogbo",
      "gbegamey",
      "appro",
      "stock",
      "immobilisations",
      "journal-ventes",
      "journal-stock",
      "historique",
    ]);
    expect(canAccessPath("comptable", "/compte-resultat", "tous")).toBe(true);
    expect(canAccessPath("comptable", "/comptabilite", "tous")).toBe(true);
    expect(canAccessPath("comptable", "/zogbo", "tous")).toBe(true);
    expect(canAccessPath("comptable", "/gbegamey", "tous")).toBe(true);
    expect(canAccessPath("comptable", "/achats", "tous")).toBe(true);
    expect(canAccessPath("comptable", "/stock", "tous")).toBe(true);
    expect(canAccessPath("comptable", "/immobilisations", "tous")).toBe(true);
    expect(canAccessPath("comptable", "/admin", "tous")).toBe(false);
    expect(canAccessPath("comptable", "/vente", "tous")).toBe(false);
    expect(canAccessPath("comptable", "/parametres", "tous")).toBe(false);
    expect(canManagePastVentes("comptable")).toBe(true);
  });

  it("couvre les deux sites", () => {
    expect(sitesForRole("comptable")).toEqual(["tous"]);
    expect(defaultSiteForRole("comptable")).toBe("tous");
    expect(effectiveSite("comptable", "tous")).toBe("tous");
  });
});

describe("étanchéité des zones", () => {
  it("s'applique au gérant rattaché à une zone", () => {
    expect(canAccessPath("gerant", "/zogbo", "gbegamey")).toBe(false);
    expect(canAccessPath("gerant", "/gbegamey", "gbegamey")).toBe(true);
    expect(canAccessPath("gerant", "/gbegamey", "zogbo")).toBe(false);
    expect(canAccessPath("gerant", "/zogbo", "zogbo")).toBe(true);
  });

  it("le gérant est rattaché à une seule zone", () => {
    expect(sitesForRole("gerant")).toEqual(["zogbo", "gbegamey"]);
    expect(defaultSiteForRole("gerant")).toBe("gbegamey");
    expect(effectiveSite("gerant", "tous")).toBe("gbegamey");
    expect(canAccessPath("gerant", "/zogbo", "tous")).toBe(false);
    expect(canAccessPath("gerant", "/zogbo", "gbegamey")).toBe(false);
    expect(canAccessPath("gerant", "/gbegamey", "gbegamey")).toBe(true);
  });

  it("le menu d'un gérant ne montre que sa zone", () => {
    const menu = navForUser("gerant", "zogbo");
    expect(menu).toContain("zogbo");
    expect(menu).not.toContain("gbegamey");
  });

  it("le gérant accède au stock sans quitter sa zone", () => {
    expect(canAccessPath("gerant", "/stock", "zogbo")).toBe(true);
    expect(navForUser("gerant", "zogbo")).toContain("stock");
  });

  it("le gérant accède au journal des ventes de SA zone", () => {
    expect(canAccessPath("gerant", "/journal-ventes", "zogbo")).toBe(true);
    expect(canAccessPath("gerant", "/historique-ventes", "zogbo")).toBe(true);
    const menu = navForUser("gerant", "zogbo");
    expect(menu).toContain("journal-ventes");
    expect(menu).not.toContain("historique-ventes");
    expect(navForUser("gerant", "zogbo")).not.toContain("gbegamey");
  });
});

function ecranPourApi(chemin: string): string {
  if (chemin === "/api/pos" || chemin.startsWith("/api/pos/")) return "/vente";
  if (chemin === "/api/pos-config") return "/reglages";
  return chemin.replace(/^\/api/, "");
}

describe("l'API suit les droits de l'écran", () => {
  it("un gérant de zone n'atteint pas l'admin ni le résultat multi-sites", () => {
    for (const route of [
      "/api/admin/users",
      "/api/compte-resultat",
      "/api/historique",
    ]) {
      expect(
        canAccessPath("gerant", ecranPourApi(route), "gbegamey"),
        route,
      ).toBe(false);
    }
  });

  it("un gérant garde vente, caisse et paramètres de sa zone", () => {
    for (const route of [
      "/api/vente",
      "/api/pos",
      "/api/caisse",
      "/api/parametres",
    ]) {
      expect(
        canAccessPath("gerant", ecranPourApi(route), "gbegamey"),
        route,
      ).toBe(true);
    }
  });

  it("un gérant de Gbégamey n'écrit pas dans le stock de Zogbo", () => {
    expect(canAccessPath("gerant", ecranPourApi("/api/zogbo"), "gbegamey"))
      .toBe(false);
    expect(canAccessPath("gerant", ecranPourApi("/api/gbegamey"), "gbegamey"))
      .toBe(true);
  });

  it("l'administrateur atteint tout, dans sa zone", () => {
    for (const route of [
      "/api/parametres",
      "/api/pos-config",
      "/api/admin/users",
      "/api/compte-resultat",
    ]) {
      expect(canAccessPath("admin", ecranPourApi(route), "tous"), route).toBe(
        true,
      );
    }
  });

  it("réserve la correction des ventes passées au gérant et à l'admin", () => {
    expect(canManagePastVentes("gerant")).toBe(true);
    expect(canManagePastVentes("admin")).toBe(true);
    expect(canManagePastVentes("comptable")).toBe(true);
    expect(canAccessPath("gerant", "/regularisation", "zogbo")).toBe(true);
    expect(canAccessPath("comptable", "/regularisation", "tous")).toBe(false);
    expect(navForUser("gerant", "zogbo")).toContain("regularisation");
  });

  it("ouvre Paramètres au gérant (catalogue et prix)", () => {
    expect(canAccessPath("gerant", "/parametres", "zogbo")).toBe(true);
    expect(canAccessPath("gerant", ecranPourApi("/api/parametres"), "zogbo")).toBe(
      true,
    );
    expect(navForUser("gerant", "zogbo")).toContain("parametres");
  });

  it("ouvre Immobilisations au gérant ; l’API reste lisible via Vente", () => {
    expect(navForUser("gerant", "zogbo")).toContain("immobilisations");
    expect(canAccessPath("gerant", "/immobilisations", "zogbo")).toBe(true);
    expect(canAccessPath("gerant", "/immobilisations", "gbegamey")).toBe(true);
  });

  it("restreint le compte Marc aux écrans direction (tableau, journaux, registre, admin)", () => {
    const menu = navForUser("admin", "tous", "marc");
    expect(menu).toEqual([
      "synthese",
      "compte-resultat",
      "comptabilite",
      "journal-ventes",
      "journal-stock",
      "historique",
      "admin",
    ]);
    expect(canAccessPath("admin", "/", "tous", "marc")).toBe(true);
    expect(canAccessPath("admin", "/compte-resultat", "tous", "marc")).toBe(
      true,
    );
    expect(canAccessPath("admin", "/comptabilite", "tous", "marc")).toBe(true);
    expect(canAccessPath("admin", "/journal-ventes", "tous", "marc")).toBe(
      true,
    );
    expect(canAccessPath("admin", "/journal-stock", "tous", "marc")).toBe(true);
    expect(canAccessPath("admin", "/historique", "tous", "marc")).toBe(true);
    expect(canAccessPath("admin", "/admin", "tous", "marc")).toBe(true);
    expect(canAccessPath("admin", "/vente", "tous", "marc")).toBe(false);
    expect(canAccessPath("admin", "/parametres", "tous", "marc")).toBe(false);
    expect(canAccessPath("admin", "/zogbo", "tous", "marc")).toBe(false);
  });

  it("donne au DAF les mêmes écrans qu’un admin, sans la page Équipe", () => {
    const menu = navForUser("daf", "tous", "daff");
    expect(menu).not.toContain("admin");
    expect(menu).toContain("vente");
    expect(menu).toContain("compte-resultat");
    expect(menu).toContain("journal-stock");
    expect(canAccessPath("daf", "/admin", "tous", "daff")).toBe(false);
    expect(
      canAccessPath("daf", "/api/admin/users".replace(/^\/api/, ""), "tous", "daff"),
    ).toBe(false);
    expect(canAccessPath("daf", "/vente", "tous", "daff")).toBe(true);
    expect(canAccessPath("daf", "/parametres", "tous", "daff")).toBe(true);
    expect(canManagePastVentes("daf")).toBe(true);
  });
});
