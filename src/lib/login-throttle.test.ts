import { describe, expect, it } from "vitest";
import { clientIpFrom } from "@/lib/login-throttle";

describe("clientIpFrom", () => {
  it("retient la dernière adresse de x-forwarded-for", () => {
    // Un client peut fournir son propre en-tête (falsifiable) ; le proxy de
    // confiance ajoute la vraie IP en dernier plutôt que de l'écraser. Ne
    // faire confiance qu'au dernier maillon évite qu'un client fasse varier
    // le premier pour contourner le anti-bruteforce par IP.
    const request = new Request("http://x", {
      headers: { "x-forwarded-for": "6.6.6.6, 10.0.0.1, 172.16.0.4" },
    });
    expect(clientIpFrom(request)).toBe("172.16.0.4");
  });

  it("renvoie la seule adresse transmise quand il n'y a qu'un maillon", () => {
    const request = new Request("http://x", {
      headers: { "x-forwarded-for": "41.85.1.2" },
    });
    expect(clientIpFrom(request)).toBe("41.85.1.2");
  });

  it("retombe sur x-real-ip en l'absence de x-forwarded-for", () => {
    const request = new Request("http://x", {
      headers: { "x-real-ip": "41.85.9.9" },
    });
    expect(clientIpFrom(request)).toBe("41.85.9.9");
  });

  it("renvoie une valeur stable quand aucune adresse n'est transmise", () => {
    // Une clé constante vaut mieux qu'une clé vide : sans cela toutes les
    // requêtes sans en-tête partageraient un compteur imprévisible.
    expect(clientIpFrom(new Request("http://x"))).toBe("inconnue");
  });

  it("ignore un en-tête vide", () => {
    const request = new Request("http://x", {
      headers: { "x-forwarded-for": "" },
    });
    expect(clientIpFrom(request)).toBe("inconnue");
  });
});
