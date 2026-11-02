import { describe, expect, it } from "vitest";
import {
  DEFAULT_SITE_ROLES_CONFIG,
  isVenteActionAllowed,
  resolveConfigForUser,
  venteActionEnabled,
  ventePermissionsFor,
} from "@/lib/site-roles-model";
import {
  authorizePermanentDelete,
  authorizeVenteAction,
} from "@/lib/site-roles-policy";

describe("site-roles-model", () => {
  it("refuse l’annulation pour tout rôle sauf admin", () => {
    expect(
      isVenteActionAllowed(
        DEFAULT_SITE_ROLES_CONFIG,
        "gerant",
        "zogbo",
        "cancel",
      ),
    ).toBe(false);
    expect(
      isVenteActionAllowed(DEFAULT_SITE_ROLES_CONFIG, "daf", "zogbo", "cancel"),
    ).toBe(false);
    expect(
      isVenteActionAllowed(
        DEFAULT_SITE_ROLES_CONFIG,
        "admin",
        "zogbo",
        "cancel",
      ),
    ).toBe(true);
  });

  it("laisse la config autoriser l'annulation à un rôle, sans jamais bloquer l'admin", () => {
    const config = {
      ...DEFAULT_SITE_ROLES_CONFIG,
      roles: {
        ...DEFAULT_SITE_ROLES_CONFIG.roles,
        gerant: { sell: true, modify: true, delete: false, cancel: true },
      },
    };
    expect(isVenteActionAllowed(config, "gerant", "zogbo", "cancel")).toBe(true);
    expect(isVenteActionAllowed(config, "gerant", "zogbo", "delete")).toBe(false);
    expect(isVenteActionAllowed(config, "admin", "zogbo", "cancel")).toBe(true);
    expect(ventePermissionsFor(config, "gerant", "zogbo").cancel).toBe(true);
  });

  it("combine site et rôle", () => {
    const config = {
      ...DEFAULT_SITE_ROLES_CONFIG,
      sites: {
        ...DEFAULT_SITE_ROLES_CONFIG.sites,
        zogbo: {
          sell: false,
          modify: true,
          delete: true,
          cancel: true,
        },
      },
    };
    expect(isVenteActionAllowed(config, "gerant", "zogbo", "sell")).toBe(false);
    expect(isVenteActionAllowed(config, "gerant", "gbegamey", "sell")).toBe(
      true,
    );
  });

  it("l'administrateur n'est jamais bridé par la configuration", () => {
    const config = {
      ...DEFAULT_SITE_ROLES_CONFIG,
      sites: {
        ...DEFAULT_SITE_ROLES_CONFIG.sites,
        zogbo: { sell: false, modify: false, delete: false, cancel: false },
      },
    };
    for (const action of ["sell", "modify", "delete", "cancel"] as const) {
      expect(isVenteActionAllowed(config, "admin", "zogbo", action)).toBe(true);
    }
    expect(ventePermissionsFor(config, "admin", "zogbo")).toEqual({
      sell: true,
      modify: true,
      delete: true,
      cancel: true,
    });
  });

  it("venteActionEnabled tolère une config absente", () => {
    expect(venteActionEnabled(null, "gerant", "zogbo", "modify")).toBe(true);
  });

  it("calcule les permissions effectives", () => {
    const perms = ventePermissionsFor(
      DEFAULT_SITE_ROLES_CONFIG,
      "comptable",
      "zogbo",
    );
    expect(perms.sell).toBe(false);
    // Modifier une vente est réservé à l'admin, même si la matrice de rôle
    // autorise encore "modify" pour ce rôle.
    expect(perms.modify).toBe(false);
  });

  it("refuse par défaut modifier, supprimer et annuler hors admin", () => {
    for (const role of ["gerant", "comptable", "daf"] as const) {
      for (const action of ["modify", "delete", "cancel"] as const) {
        expect(
          isVenteActionAllowed(DEFAULT_SITE_ROLES_CONFIG, role, "zogbo", action),
          `${role}:${action}`,
        ).toBe(false);
      }
    }
    expect(isVenteActionAllowed(DEFAULT_SITE_ROLES_CONFIG, "gerant", "zogbo", "sell")).toBe(true);
  });

  it("donne priorité au droit propre d'un compte, par site", () => {
    const config = {
      ...DEFAULT_SITE_ROLES_CONFIG,
      users: {
        "aaaaaaaaaaaaaaaaaaaaaaaa": {
          zogbo: { delete: true },
          gbegamey: { sell: false },
        },
      },
    };
    const id = "aaaaaaaaaaaaaaaaaaaaaaaa";
    // droit accordé au compte seulement, sur Zogbo seulement
    expect(isVenteActionAllowed(config, "gerant", "zogbo", "delete", id)).toBe(true);
    expect(isVenteActionAllowed(config, "gerant", "gbegamey", "delete", id)).toBe(false);
    expect(isVenteActionAllowed(config, "gerant", "zogbo", "delete", "bbbbbbbbbbbbbbbbbbbbbbbb")).toBe(false);
    expect(isVenteActionAllowed(config, "gerant", "zogbo", "delete")).toBe(false);
    // droit retiré au compte alors que le rôle l'autorise
    expect(isVenteActionAllowed(config, "gerant", "gbegamey", "sell", id)).toBe(false);
    expect(isVenteActionAllowed(config, "gerant", "gbegamey", "sell", "bbbbbbbbbbbbbbbbbbbbbbbb")).toBe(true);
    // l'admin n'est jamais limité par un réglage de compte
    expect(isVenteActionAllowed(config, "admin", "gbegamey", "sell", id)).toBe(true);
  });

  it("aplatit la config pour un compte : l'affichage suit exactement le serveur", () => {
    const id = "aaaaaaaaaaaaaaaaaaaaaaaa";
    const config = {
      ...DEFAULT_SITE_ROLES_CONFIG,
      users: { [id]: { zogbo: { modify: true } } },
    };
    const plat = resolveConfigForUser(config, "gerant", id);
    expect(plat.users).toBeUndefined();
    expect(venteActionEnabled(plat, "gerant", "zogbo", "modify")).toBe(true);
    expect(venteActionEnabled(plat, "gerant", "gbegamey", "modify")).toBe(false);
    expect(venteActionEnabled(plat, "gerant", "zogbo", "sell")).toBe(true);
  });
});

describe("authorizeVenteAction", () => {
  it("bloque avec un message explicite", () => {
    const config = {
      ...DEFAULT_SITE_ROLES_CONFIG,
      roles: {
        ...DEFAULT_SITE_ROLES_CONFIG.roles,
        daf: {
          sell: true,
          modify: false,
          delete: false,
          cancel: true,
        },
      },
    };
    const decision = authorizeVenteAction({
      config,
      role: "daf",
      site: "gbegamey",
      action: "modify",
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.status).toBe(403);
      expect(decision.error).toContain("Modification");
    }
  });
});

describe("authorizePermanentDelete", () => {
  it("exige un motif d'audit", () => {
    const decision = authorizePermanentDelete({
      config: DEFAULT_SITE_ROLES_CONFIG,
      role: "admin",
      site: "zogbo",
      reason: "court",
    });
    expect(decision.ok).toBe(false);
  });
});
