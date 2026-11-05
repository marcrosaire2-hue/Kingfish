import { describe, expect, it } from "vitest";
import { estEcritureEnConsultation } from "@/lib/auth-types";
import { resourceHasWrite, resourceById } from "@/lib/autorisations-model";

describe("Autorisations — Consulter seulement", () => {
  it("sans réglage, aucune écriture n'est bloquée", () => {
    expect(estEcritureEnConsultation({ nav: ["vente", "gbegamey"] }, "/vente")).toBe(false);
  });

  it("bloque l'écriture d'une page en consultation seule", () => {
    const user = { nav: ["vente", "gbegamey"] as const, ro: ["gbegamey"] as const };
    expect(estEcritureEnConsultation({ nav: [...user.nav], ro: [...user.ro] }, "/stock-gbegamey")).toBe(true);
    expect(estEcritureEnConsultation({ nav: [...user.nav], ro: [...user.ro] }, "/gbegamey")).toBe(true);
  });

  it("laisse modifier les autres pages du même compte", () => {
    expect(estEcritureEnConsultation({ nav: ["vente", "gbegamey"], ro: ["gbegamey"] }, "/vente")).toBe(false);
  });

  it("une page couverte aussi par une page modifiable reste modifiable", () => {
    // /boissons relève de Zogbo ou de Gbégamey : modifiable si l'un des deux l'est.
    expect(
      estEcritureEnConsultation({ nav: ["zogbo", "gbegamey"], ro: ["zogbo"] }, "/boissons"),
    ).toBe(false);
    expect(
      estEcritureEnConsultation({ nav: ["zogbo", "gbegamey"], ro: ["zogbo", "gbegamey"] }, "/boissons"),
    ).toBe(true);
  });

  it("seules les pages où l'on enregistre proposent le choix", () => {
    expect(resourceHasWrite(resourceById("vente")!)).toBe(true);
    expect(resourceHasWrite(resourceById("analyse")!)).toBe(false);
  });
});
