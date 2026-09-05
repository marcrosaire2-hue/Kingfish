import { describe, expect, it } from "vitest";
import {
  resolveActionDecision,
  isActionAllowed,
} from "@/lib/autorisations-repo";
import { EMPTY_AUTORISATIONS } from "@/lib/autorisations-model";

describe("autorisations — résolution", () => {
  it("hérite du menu code quand aucune règle", () => {
    const r = resolveActionDecision({
      config: EMPTY_AUTORISATIONS,
      role: "gerant",
      resourceId: "vente",
      action: "access",
      defaultAllowed: true,
    });
    expect(r).toEqual({ value: "allow", source: "inherit" });
  });

  it("applique un deny de rôle", () => {
    const r = resolveActionDecision({
      config: {
        ...EMPTY_AUTORISATIONS,
        overrides: [
          {
            targetType: "role",
            targetId: "gerant",
            resourceId: "parametres",
            actions: { access: "deny" },
          },
        ],
      },
      role: "gerant",
      resourceId: "parametres",
      action: "access",
      defaultAllowed: true,
    });
    expect(r).toEqual({ value: "deny", source: "role" });
  });

  it("priorise l’override utilisateur sur le rôle", () => {
    const r = resolveActionDecision({
      config: {
        ...EMPTY_AUTORISATIONS,
        overrides: [
          {
            targetType: "role",
            targetId: "gerant",
            resourceId: "vente",
            actions: { access: "deny" },
          },
          {
            targetType: "user",
            targetId: "u1",
            resourceId: "vente",
            actions: { access: "allow" },
          },
        ],
      },
      role: "gerant",
      userId: "u1",
      resourceId: "vente",
      action: "access",
      defaultAllowed: true,
    });
    expect(r).toEqual({ value: "allow", source: "user" });
  });

  it("interdit Équipe aux non-admins même avec override allow", () => {
    const config = {
      ...EMPTY_AUTORISATIONS,
      overrides: [
        {
          targetType: "role" as const,
          targetId: "gerant",
          resourceId: "admin",
          actions: { access: "allow" as const },
        },
      ],
    };
    expect(
      isActionAllowed({
        config,
        role: "gerant",
        site: "zogbo",
        resourceId: "admin",
        action: "access",
      }),
    ).toBe(false);
    expect(
      isActionAllowed({
        config,
        role: "admin",
        site: "tous",
        resourceId: "admin",
        action: "access",
      }),
    ).toBe(true);
  });

  it("garde Équipe et la matrice allumées pour tout admin, même en deny", () => {
    const config = {
      ...EMPTY_AUTORISATIONS,
      overrides: [
        {
          targetType: "role" as const,
          targetId: "admin",
          resourceId: "admin",
          actions: { access: "deny" as const },
        },
        {
          targetType: "role" as const,
          targetId: "admin",
          resourceId: "autorisations",
          actions: { access: "deny" as const },
        },
      ],
    };
    expect(
      isActionAllowed({
        config,
        role: "admin",
        site: "gbegamey",
        username: "chef-zone",
        resourceId: "admin",
        action: "access",
      }),
    ).toBe(true);
    expect(
      isActionAllowed({
        config,
        role: "admin",
        site: "tous",
        username: "admin",
        resourceId: "autorisations",
        action: "access",
      }),
    ).toBe(true);
    expect(
      isActionAllowed({
        config: {
          ...EMPTY_AUTORISATIONS,
          overrides: [
            {
              targetType: "role" as const,
              targetId: "daf",
              resourceId: "admin",
              actions: { access: "allow" as const },
            },
          ],
        },
        role: "daf",
        site: "tous",
        username: "daff",
        resourceId: "admin",
        action: "access",
      }),
    ).toBe(false);
    expect(
      isActionAllowed({
        config: EMPTY_AUTORISATIONS,
        role: "daf",
        site: "tous",
        resourceId: "autorisations",
        action: "access",
      }),
    ).toBe(false);
  });
});
