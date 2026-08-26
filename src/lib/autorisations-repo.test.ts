import { describe, expect, it } from "vitest";
import {
  resolveActionDecision,
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
});
