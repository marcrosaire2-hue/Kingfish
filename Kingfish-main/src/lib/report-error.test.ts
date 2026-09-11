import { afterEach, describe, expect, it, vi } from "vitest";
import { reportError } from "@/lib/report-error";

afterEach(() => {
  vi.restoreAllMocks();
});

function capturer(): { lignes: string[] } {
  const lignes: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    lignes.push(String(args[0]));
  });
  return { lignes };
}

describe("reportError", () => {
  it("écrit une entrée JSON sur une seule ligne", () => {
    const { lignes } = capturer();
    reportError("POST /api/vente", new Error("Stock insuffisant"));

    expect(lignes).toHaveLength(1);
    expect(lignes[0]).not.toContain("\n");
    const entree = JSON.parse(lignes[0]!);
    expect(entree.niveau).toBe("erreur");
    expect(entree.operation).toBe("POST /api/vente");
    expect(entree.message).toBe("Stock insuffisant");
    expect(entree.horodatage).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("renvoie le message, pour que l'appelant ne le reconstruise pas", () => {
    capturer();
    expect(reportError("op", new Error("Boum"))).toBe("Boum");
  });

  it("accepte une valeur lancée qui n'est pas une Error", () => {
    const { lignes } = capturer();
    const message = reportError("op", "panne réseau");
    expect(message).toBe("panne réseau");
    expect(JSON.parse(lignes[0]!).pile).toBeUndefined();
  });

  it("joint le contexte fourni", () => {
    const { lignes } = capturer();
    reportError("POST /api/pos", new Error("x"), { site: "gbegamey", lignes: 3 });
    const entree = JSON.parse(lignes[0]!);
    expect(entree.site).toBe("gbegamey");
    expect(entree.lignes).toBe(3);
  });

  it("conserve la pile d'appel quand elle existe", () => {
    const { lignes } = capturer();
    reportError("op", new Error("avec pile"));
    expect(JSON.parse(lignes[0]!).pile).toContain("Error: avec pile");
  });
});
