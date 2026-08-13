import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ajouterEnAttente,
  fileEnAttente,
  nombreEnAttente,
  synchroniser,
} from "@/lib/offline-queue";

/** localStorage minimal : les tests tournent en environnement Node. */
function installerStockage() {
  const donnees = new Map<string, string>();
  const stockage = {
    getItem: (k: string) => donnees.get(k) ?? null,
    setItem: (k: string, v: string) => void donnees.set(k, v),
    removeItem: (k: string) => void donnees.delete(k),
    clear: () => donnees.clear(),
  };
  vi.stubGlobal("window", { localStorage: stockage });
  return stockage;
}

beforeEach(() => {
  installerStockage();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("file d'attente", () => {
  it("conserve la vente et son horodatage d'encaissement", () => {
    const entree = ajouterEnAttente({ action: "validate", montant: 1500 });
    expect(nombreEnAttente()).toBe(1);
    expect(entree.creeA).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(entree.tentatives).toBe(0);
  });

  it("préserve l'ordre d'encaissement", () => {
    ajouterEnAttente({ n: 1 });
    ajouterEnAttente({ n: 2 });
    ajouterEnAttente({ n: 3 });
    expect(fileEnAttente().map((e) => (e.corps as { n: number }).n)).toEqual([
      1, 2, 3,
    ]);
  });

  it("attribue une référence unique à chaque vente", () => {
    const a = ajouterEnAttente({ n: 1 });
    const b = ajouterEnAttente({ n: 2 });
    expect(a.id).not.toBe(b.id);
  });

  it("reprend la référence déjà envoyée au serveur", () => {
    // Vente partie mais réponse perdue : le rejeu doit porter la référence de
    // la tentative en ligne, sinon le serveur crée un second ticket.
    const entree = ajouterEnAttente({ n: 1 }, "pos-1700000000000-abc123");
    expect(entree.id).toBe("pos-1700000000000-abc123");
    expect(fileEnAttente()[0]!.id).toBe("pos-1700000000000-abc123");
  });
});

describe("synchronisation", () => {
  it("vide la file quand le serveur accepte les ventes", async () => {
    ajouterEnAttente({ n: 1 });
    ajouterEnAttente({ n: 2 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    const res = await synchroniser();
    expect(res.envoyees).toBe(2);
    expect(nombreEnAttente()).toBe(0);
  });

  it("transmet la référence locale, pour ne pas encaisser deux fois", async () => {
    const entree = ajouterEnAttente({ n: 1 });
    const appel = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", appel);

    await synchroniser();
    const entetes = appel.mock.calls[0]![1].headers as Record<string, string>;
    expect(entetes["X-Vente-Locale"]).toBe(entree.id);
  });

  it("garde tout en file tant que le réseau est coupé", async () => {
    ajouterEnAttente({ n: 1 });
    ajouterEnAttente({ n: 2 });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("hors ligne")));

    const res = await synchroniser();
    expect(res.envoyees).toBe(0);
    expect(nombreEnAttente()).toBe(2);
  });

  it("s'arrête à la première panne serveur, sans casser l'ordre", async () => {
    ajouterEnAttente({ n: 1 });
    ajouterEnAttente({ n: 2 });
    const appel = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal("fetch", appel);

    await synchroniser();
    // Une seule tentative : inutile de marteler un serveur en panne.
    expect(appel).toHaveBeenCalledTimes(1);
    expect(nombreEnAttente()).toBe(2);
  });

  it("abandonne une vente refusée après trois tentatives", async () => {
    ajouterEnAttente({ n: 1 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400 }));

    await synchroniser();
    expect(nombreEnAttente()).toBe(1);
    await synchroniser();
    expect(nombreEnAttente()).toBe(1);
    await synchroniser();
    // Sans cette sortie, une vente définitivement refusée figerait toutes
    // les suivantes.
    expect(nombreEnAttente()).toBe(0);
  });
});
