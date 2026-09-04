import { describe, expect, it } from "vitest";
import {
  assertPreuveFile,
  canConfirmVersement,
  canDeclareVersement,
  canDeleteVersement,
  canEditVersement,
  defaultTrancheFromShift,
  parseVersementHeure,
  parseVersementMembres,
  parseVersementMontant,
  parseVersementNumero,
  parseVersementTranche,
} from "@/lib/versements-model";

describe("droits versements", () => {
  it("seul le gérant déclare / modifie / supprime ; seul le comptable confirme ; admin/DAF lecteurs", () => {
    expect(canDeclareVersement("gerant")).toBe(true);
    expect(canDeclareVersement("admin")).toBe(false);
    expect(canDeclareVersement("comptable")).toBe(false);
    expect(canDeclareVersement("daf")).toBe(false);

    expect(canEditVersement("gerant")).toBe(true);
    expect(canEditVersement("comptable")).toBe(false);
    expect(canDeleteVersement("gerant")).toBe(true);
    expect(canDeleteVersement("admin")).toBe(false);

    expect(canConfirmVersement("comptable")).toBe(true);
    expect(canConfirmVersement("daf")).toBe(false);
    expect(canConfirmVersement("admin")).toBe(false);
    expect(canConfirmVersement("gerant")).toBe(false);
  });
});

describe("validation versement", () => {
  it("accepte une heure HH:MM valide", () => {
    expect(parseVersementHeure("20:45")).toBe("20:45");
    expect(parseVersementHeure("20:45:00")).toBe("20:45");
    expect(parseVersementHeure("9:05")).toBe("09:05");
    expect(() => parseVersementHeure("25:00")).toThrow(/Heure/);
    expect(() => parseVersementHeure("8h45")).not.toThrow();
    expect(parseVersementHeure("8h45")).toBe("08:45");
  });

  it("exige un montant positif arrondi", () => {
    expect(parseVersementMontant("150000")).toBe(150000);
    expect(parseVersementMontant("150 000")).toBe(150000);
    expect(() => parseVersementMontant(0)).toThrow(/Montant/);
    expect(() => parseVersementMontant(-10)).toThrow(/Montant/);
  });

  it("exige un numéro de transaction", () => {
    expect(parseVersementNumero("MTN-998877")).toBe("MTN-998877");
    expect(() => parseVersementNumero("ab")).toThrow(/Numéro/);
  });

  it("exige une tranche d’horaire", () => {
    expect(parseVersementTranche("matin")).toBe("matin");
    expect(parseVersementTranche("soir")).toBe("soir");
    expect(parseVersementTranche("nuit")).toBe("nuit");
    expect(() => parseVersementTranche("")).toThrow(/Tranche/);
    expect(() => parseVersementTranche("midi")).toThrow(/Tranche/);
  });

  it("exige les noms des membres présents", () => {
    expect(parseVersementMembres(["Akpovo Urich", "Sebio"])).toEqual([
      "Akpovo Urich",
      "Sebio",
    ]);
    expect(parseVersementMembres("Akpovo\nSebio")).toEqual([
      "Akpovo",
      "Sebio",
    ]);
    expect(() => parseVersementMembres([])).toThrow(/membre/);
    expect(() => parseVersementMembres(["A"])).toThrow(/court/);
  });

  it("propose la tranche depuis le shift du compte", () => {
    expect(defaultTrancheFromShift("jour")).toBe("matin");
    expect(defaultTrancheFromShift("soir")).toBe("soir");
    expect(defaultTrancheFromShift("nuit")).toBe("nuit");
  });

  it("refuse une preuve hors format ou trop lourde", () => {
    expect(() =>
      assertPreuveFile({ mime: "application/pdf", size: 1000 }),
    ).toThrow(/JPEG/);
    expect(() =>
      assertPreuveFile({ mime: "image/png", size: 0 }),
    ).toThrow(/manquante/);
    expect(() =>
      assertPreuveFile({ mime: "image/jpeg", size: 5 * 1024 * 1024 }),
    ).toThrow(/4 Mo/);
    expect(() =>
      assertPreuveFile({ mime: "image/jpeg", size: 1200 }),
    ).not.toThrow();
    expect(() =>
      assertPreuveFile({
        mime: "",
        size: 1200,
        filename: "capture.PNG",
      }),
    ).not.toThrow();
  });
});
