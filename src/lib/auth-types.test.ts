import { describe, expect, it } from "vitest";
import {
  assertAdminCanManageTarget,
  canAccessPath,
  canManagePastVentes,
  canWriteStock,
  defaultSiteForRole,
  effectiveSite,
  filterNavKeysBySite,
  navForSession,
  navForUser,
  sitesForRole,
  userVisibleToAdmin,
} from "@/lib/auth-types";

describe("rôle Comptable", () => {
  it("ouvre la finance et la consultation stock, sans vente, analyse ni registre", () => {
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
      "quantites-vendues",
      "rapport-quotidien",
      "controle",
    ]);
    expect(menu).not.toContain("analyse");
    expect(menu).not.toContain("historique");
    expect(canAccessPath("comptable", "/compte-resultat", "tous")).toBe(true);
    expect(canAccessPath("comptable", "/comptabilite", "tous")).toBe(true);
    expect(canAccessPath("comptable", "/zogbo", "tous")).toBe(true);
    expect(canAccessPath("comptable", "/gbegamey", "tous")).toBe(true);
    expect(canAccessPath("comptable", "/stock-gbegamey", "tous")).toBe(true);
    expect(canAccessPath("comptable", "/achats", "tous")).toBe(true);
    expect(canAccessPath("comptable", "/stock", "tous")).toBe(true);
    expect(canAccessPath("comptable", "/immobilisations", "tous")).toBe(true);
    expect(canAccessPath("comptable", "/analyse", "tous")).toBe(false);
    expect(canAccessPath("comptable", "/historique", "tous")).toBe(false);
    expect(canAccessPath("comptable", "/admin", "tous")).toBe(false);
    expect(canAccessPath("comptable", "/vente", "tous")).toBe(false);
    expect(canAccessPath("comptable", "/parametres", "tous")).toBe(false);
    expect(canWriteStock("comptable")).toBe(false);
    expect(canManagePastVentes("comptable")).toBe(true);
  });

  it("empêche le comptable de récupérer Analyse et Registre via un JWT", () => {
    const navAvecPages = [
      "analyse",
      "historique",
      "synthese",
      "zogbo",
    ] as const;
    expect(
      canAccessPath("comptable", "/analyse", "tous", undefined, [
        ...navAvecPages,
      ]),
    ).toBe(false);
    expect(
      canAccessPath("comptable", "/historique", "tous", undefined, [
        ...navAvecPages,
      ]),
    ).toBe(false);
    expect(
      filterNavKeysBySite([...navAvecPages], "comptable", "tous"),
    ).toEqual(["synthese", "zogbo"]);
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

  it("filterNavKeysBySite retire Gbégamey même si la clé était ajoutée par autorisations", () => {
    const withGbegamey: ReturnType<typeof navForUser> = [
      ...navForUser("gerant", "zogbo"),
      "gbegamey",
    ];
    expect(filterNavKeysBySite(withGbegamey, "gerant", "zogbo")).not.toContain(
      "gbegamey",
    );
  });

  it("le gérant accède au stock Gbégamey sans quitter sa zone", () => {
    expect(canAccessPath("gerant", "/stock-gbegamey", "gbegamey")).toBe(true);
    expect(canAccessPath("gerant", "/gbegamey", "gbegamey")).toBe(true);
    expect(canAccessPath("gerant", "/stock-gbegamey", "zogbo")).toBe(false);
    expect(navForUser("gerant", "gbegamey")).toContain("gbegamey");
  });

  it("l’ancienne URL /combos suit le droit zogbo (redirection)", () => {
    expect(canAccessPath("gerant", "/combos", "zogbo")).toBe(true);
    expect(navForUser("gerant", "zogbo")).not.toContain("combos");
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

  it("retire Immobilisations au gérant, même si Vente ou un JWT l’ajoute", () => {
    expect(navForUser("gerant", "zogbo")).not.toContain("immobilisations");
    expect(navForUser("gerant", "gbegamey")).not.toContain("immobilisations");
    expect(canAccessPath("gerant", "/immobilisations", "zogbo")).toBe(false);
    expect(canAccessPath("gerant", "/immobilisations", "gbegamey")).toBe(false);
    expect(
      canAccessPath("gerant", "/immobilisations", "zogbo", undefined, [
        "vente",
        "immobilisations",
      ]),
    ).toBe(false);
    expect(
      filterNavKeysBySite(
        ["vente", "immobilisations", "pertes"],
        "gerant",
        "zogbo",
      ),
    ).not.toContain("immobilisations");
    expect(
      navForSession({
        role: "gerant",
        site: "zogbo",
        username: "gerant-zogbo",
        nav: ["vente", "immobilisations", "caisse"],
      }),
    ).not.toContain("immobilisations");
  });

  it("restreint le compte Marc aux écrans direction (tableau, journaux, registre, admin)", () => {
    const menu = navForUser("admin", "tous", "marc");
    expect(menu).toEqual([
      "synthese",
      "analyse",
      "compte-resultat",
      "comptabilite",
      "journal-ventes",
      "quantites-vendues",
      "historique",
      "rapport-quotidien",
      "controle",
      "admin",
    ]);
    expect(canAccessPath("admin", "/analyse", "tous", "marc")).toBe(true);
    expect(canAccessPath("admin", "/", "tous", "marc")).toBe(true);
    expect(canAccessPath("admin", "/compte-resultat", "tous", "marc")).toBe(
      true,
    );
    expect(canAccessPath("admin", "/comptabilite", "tous", "marc")).toBe(true);
    expect(canAccessPath("admin", "/journal-ventes", "tous", "marc")).toBe(
      true,
    );
    expect(canAccessPath("admin", "/historique", "tous", "marc")).toBe(true);
    expect(canAccessPath("admin", "/admin", "tous", "marc")).toBe(true);
    expect(canAccessPath("admin", "/autorisations", "tous", "marc")).toBe(true);
    expect(canAccessPath("admin", "/vente", "tous", "marc")).toBe(false);
    expect(canAccessPath("admin", "/parametres", "tous", "marc")).toBe(false);
    expect(canAccessPath("admin", "/zogbo", "tous", "marc")).toBe(false);
  });

  it("donne à Marc la visibilité et la gestion de tous les comptes", () => {
    const marc = { role: "admin" as const, site: "tous" as const, username: "marc" };
    const zoneGerant = {
      role: "gerant" as const,
      site: "zogbo" as const,
      username: "paul",
    };
    const principal = {
      role: "admin" as const,
      site: "tous" as const,
      username: "admin",
    };

    expect(userVisibleToAdmin(marc, zoneGerant)).toBe(true);
    expect(userVisibleToAdmin(marc, principal)).toBe(true);
    expect(() => assertAdminCanManageTarget(marc, principal)).not.toThrow();
    expect(() => assertAdminCanManageTarget(marc, zoneGerant)).not.toThrow();
  });

  it("réserve Équipe au rôle admin même si le menu JWT l’inclut", () => {
    const navAvecEquipe = ["vente", "admin"] as const;
    expect(
      canAccessPath("gerant", "/admin", "zogbo", undefined, [...navAvecEquipe]),
    ).toBe(false);
    expect(
      canAccessPath("daf", "/admin", "tous", "daff", [...navAvecEquipe]),
    ).toBe(false);
    expect(
      canAccessPath("admin", "/admin", "tous", "marc", [...navAvecEquipe]),
    ).toBe(true);
  });

  it("retire au DAF vente, pertes, registre, régularisation, réglages POS et comptabilité", () => {
    const menu = navForUser("daf", "tous", "daff");
    expect(menu).not.toContain("admin");
    expect(menu).not.toContain("vente");
    expect(menu).not.toContain("pertes");
    expect(menu).not.toContain("regularisation");
    expect(menu).not.toContain("historique");
    expect(menu).not.toContain("reglages");
    expect(menu).not.toContain("comptabilite");
    expect(menu).toContain("compte-resultat");
    expect(menu).toContain("zogbo");
    expect(menu).toContain("gbegamey");
    expect(canAccessPath("daf", "/admin", "tous", "daff")).toBe(false);
    expect(canAccessPath("daf", "/vente", "tous", "daff")).toBe(false);
    expect(canAccessPath("daf", "/pertes", "tous", "daff")).toBe(false);
    expect(canAccessPath("daf", "/regularisation", "tous", "daff")).toBe(false);
    expect(canAccessPath("daf", "/historique", "tous", "daff")).toBe(false);
    expect(canAccessPath("daf", "/reglages", "tous", "daff")).toBe(false);
    expect(canAccessPath("daf", "/comptabilite", "tous", "daff")).toBe(false);
    expect(canAccessPath("daf", "/stock-zogbo", "tous", "daff")).toBe(true);
    expect(canAccessPath("daf", "/parametres", "tous", "daff")).toBe(true);
    expect(canWriteStock("daf")).toBe(false);
    expect(canWriteStock("comptable")).toBe(false);
    expect(canWriteStock("gerant")).toBe(true);
    expect(canManagePastVentes("daf")).toBe(true);
  });

  it("empêche le DAF de récupérer ces pages via un JWT ou une matrice", () => {
    const navAvecOps = [
      "vente",
      "pertes",
      "regularisation",
      "historique",
      "reglages",
      "comptabilite",
      "zogbo",
    ] as const;
    expect(
      canAccessPath("daf", "/vente", "tous", "daff", [...navAvecOps]),
    ).toBe(false);
    expect(
      canAccessPath("daf", "/pertes", "tous", "daff", [...navAvecOps]),
    ).toBe(false);
    expect(
      canAccessPath("daf", "/historique", "tous", "daff", [...navAvecOps]),
    ).toBe(false);
    expect(
      filterNavKeysBySite([...navAvecOps], "daf", "tous"),
    ).toEqual(["zogbo"]);
    expect(
      navForSession({
        role: "daf",
        site: "tous",
        username: "daff",
        nav: [...navAvecOps],
      }),
    ).not.toContain("vente");
  });
});
