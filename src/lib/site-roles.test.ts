import { describe, expect, it } from "vitest";
import {
  DEFAULT_SITE_ROLES_CONFIG,
  isVenteActionAllowed,
  venteActionEnabled,
  ventePermissionsFor,
} from "@/lib/site-roles-model";
import {
  authorizePermanentDelete,
  authorizeVenteAction,
} from "@/lib/site-roles-policy";

describe("site-roles-model", () => {
  it("autorise tout par défaut pour gérant sur Zogbo", () => {
    expect(
      isVenteActionAllowed(
        DEFAULT_SITE_ROLES_CONFIG,
        "gerant",
        "zogbo",
        "cancel",
      ),
    ).toBe(true);
  });

  it("refuse une action désactivée pour un rôle", () => {
    const config = {
      ...DEFAULT_SITE_ROLES_CONFIG,
      roles: {
        ...DEFAULT_SITE_ROLES_CONFIG.roles,
        gerant: {
          sell: true,
          modify: true,
          delete: false,
          cancel: false,
        },
      },
    };
    expect(isVenteActionAllowed(config, "gerant", "zogbo", "cancel")).toBe(
      false,
    );
    expect(isVenteActionAllowed(config, "admin", "zogbo", "cancel")).toBe(true);
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
    expect(isVenteActionAllowed(config, "admin", "zogbo", "sell")).toBe(false);
    expect(isVenteActionAllowed(config, "admin", "gbegamey", "sell")).toBe(
      true,
    );
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
    expect(perms.modify).toBe(true);
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
