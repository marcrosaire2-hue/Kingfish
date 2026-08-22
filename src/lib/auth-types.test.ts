import { describe, expect, it } from "vitest";
import {
  canAccessPath,
  canManagePastVentes,
  defaultSiteForRole,
  effectiveSite,
  navForUser,
  sitesForRole,
} from "@/lib/auth-types";

/**
 * Le rôle « equipier » réunit vendeur et cuisine. Ces tests verrouillent deux
 * promesses : il ne donne accès à rien de plus que l'union des deux, et il
 * reste enfermé dans sa zone.
 */
describe("rôle Vente & Cuisine", () => {
  it("réunit exactement les accès du vendeur et de la cuisine", () => {
    const vendeur = new Set(navForUser("vendeur", "gbegamey"));
    const cuisine = new Set(navForUser("cuisine", "gbegamey"));
    const equipier = navForUser("equipier", "gbegamey");

    for (const cle of equipier) {
      expect(
        vendeur.has(cle) || cuisine.has(cle),
        `${cle} n'appartient ni au vendeur ni à la cuisine`,
      ).toBe(true);
    }
    for (const cle of [...vendeur, ...cuisine]) {
      expect(equipier, `${cle} manque à l'équipier`).toContain(cle);
    }
  });

  it("n'ouvre aucun écran de pilotage réservé au gérant", () => {
    for (const chemin of [
      "/compte-resultat",
      "/parametres",
      "/reglages",
      "/admin",
      "/historique",
      "/stock",
      "/journal-ventes",
      "/journal-stock",
    ]) {
      expect(canAccessPath("equipier", chemin, "gbegamey")).toBe(false);
    }
  });

  it("donne accès à la vente et à la production de sa zone", () => {
    for (const chemin of [
      "/vente",
      "/caisse",
      "/appro",
      "/achats",
      "/matieres",
      "/pertes",
    ]) {
      expect(canAccessPath("equipier", chemin, "gbegamey")).toBe(true);
    }
  });

  it("est rattaché à une seule zone, jamais aux deux", () => {
    expect(sitesForRole("equipier")).toEqual(["zogbo", "gbegamey"]);
    expect(defaultSiteForRole("equipier")).toBe("gbegamey");
    // Un compte hérité marqué « tous » est ramené à une zone unique.
    expect(effectiveSite("equipier", "tous")).toBe("gbegamey");
  });
});

describe("étanchéité des zones", () => {
  it("un équipier de Gbégamey n'atteint pas l'écran de Zogbo", () => {
    expect(canAccessPath("equipier", "/zogbo", "gbegamey")).toBe(false);
    expect(canAccessPath("equipier", "/gbegamey", "gbegamey")).toBe(true);
  });

  it("un équipier de Zogbo n'atteint pas l'écran de Gbégamey", () => {
    expect(canAccessPath("equipier", "/gbegamey", "zogbo")).toBe(false);
    expect(canAccessPath("equipier", "/zogbo", "zogbo")).toBe(true);
  });

  it("s'applique aussi au gérant rattaché à une zone", () => {
    expect(canAccessPath("gerant", "/zogbo", "gbegamey")).toBe(false);
    expect(canAccessPath("gerant", "/gbegamey", "gbegamey")).toBe(true);
  });

  it("le gérant est lui aussi rattaché à une seule zone", () => {
    expect(sitesForRole("gerant")).toEqual(["zogbo", "gbegamey"]);
    expect(defaultSiteForRole("gerant")).toBe("gbegamey");
    // Un gérant hérité marqué « tous » est ramené à une zone unique.
    expect(effectiveSite("gerant", "tous")).toBe("gbegamey");
    expect(canAccessPath("gerant", "/zogbo", "tous")).toBe(false);
    expect(canAccessPath("gerant", "/zogbo", "gbegamey")).toBe(false);
    expect(canAccessPath("gerant", "/gbegamey", "gbegamey")).toBe(true);
  });

  it("le menu d'un équipier ne montre que sa zone", () => {
    const menu = navForUser("equipier", "zogbo");
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
    // La zone est imposée par l'API : le menu ne propose que la sienne.
    expect(navForUser("gerant", "zogbo")).not.toContain("gbegamey");
  });
});

/**
 * Le contrôle des rôles porte désormais aussi sur l'API : chaque route est
 * évaluée avec les droits de l'écran correspondant. Ces cas reproduisent la
 * correspondance appliquée par le middleware.
 */
function ecranPourApi(chemin: string): string {
  if (chemin === "/api/pos" || chemin.startsWith("/api/pos/")) return "/vente";
  if (chemin === "/api/pos-config") return "/reglages";
  return chemin.replace(/^\/api/, "");
}

describe("l'API suit les droits de l'écran", () => {
  it("un vendeur ne peut pas réécrire le catalogue ni lire le résultat", () => {
    for (const route of [
      "/api/parametres",
      "/api/compte-resultat",
      "/api/pos-config",
      "/api/admin/users",
      "/api/historique",
    ]) {
      expect(
        canAccessPath("vendeur", ecranPourApi(route), "gbegamey"),
        route,
      ).toBe(false);
    }
  });

  it("un vendeur garde ce dont sa caisse a besoin", () => {
    for (const route of ["/api/vente", "/api/pos", "/api/caisse"]) {
      expect(
        canAccessPath("vendeur", ecranPourApi(route), "gbegamey"),
        route,
      ).toBe(true);
    }
  });

  it("un équipier de Gbégamey n'écrit pas dans le stock de Zogbo", () => {
    expect(canAccessPath("equipier", ecranPourApi("/api/zogbo"), "gbegamey"))
      .toBe(false);
    expect(canAccessPath("equipier", ecranPourApi("/api/gbegamey"), "gbegamey"))
      .toBe(true);
  });

  it("la cuisine déclare ses pertes mais n'encaisse pas", () => {
    expect(canAccessPath("cuisine", ecranPourApi("/api/pertes"), "zogbo"))
      .toBe(true);
    expect(canAccessPath("cuisine", ecranPourApi("/api/pos"), "zogbo"))
      .toBe(false);
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
    expect(canManagePastVentes("vendeur")).toBe(false);
    expect(canManagePastVentes("equipier")).toBe(false);
    expect(canAccessPath("gerant", "/regularisation", "zogbo")).toBe(true);
    expect(canAccessPath("vendeur", "/regularisation", "zogbo")).toBe(false);
    expect(navForUser("gerant", "zogbo")).toContain("regularisation");
  });

  it("ouvre Paramètres au gérant (catalogue et prix)", () => {
    expect(canAccessPath("gerant", "/parametres", "zogbo")).toBe(true);
    expect(canAccessPath("gerant", ecranPourApi("/api/parametres"), "zogbo")).toBe(
      true,
    );
    expect(navForUser("gerant", "zogbo")).toContain("parametres");
    expect(canAccessPath("vendeur", "/parametres", "gbegamey")).toBe(false);
  });

  it("ouvre Immobilisations au gérant ; l’API reste lisible en caisse", () => {
    expect(navForUser("gerant", "zogbo")).toContain("immobilisations");
    expect(canAccessPath("gerant", "/immobilisations", "zogbo")).toBe(true);
    expect(canAccessPath("vendeur", "/immobilisations", "gbegamey")).toBe(true);
    expect(navForUser("vendeur", "gbegamey")).not.toContain("immobilisations");
  });

  it("restreint le compte Marc aux écrans direction (tableau, journaux, registre, admin)", () => {
    const menu = navForUser("admin", "tous", "marc");
    expect(menu).toEqual([
      "synthese",
      "journal-ventes",
      "journal-stock",
      "historique",
      "admin",
    ]);
    expect(canAccessPath("admin", "/", "tous", "marc")).toBe(true);
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
});
