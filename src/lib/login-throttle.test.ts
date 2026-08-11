import { describe, expect, it } from "vitest";
import { clientIpFrom } from "@/lib/login-throttle";

describe("clientIpFrom", () => {
  it("retient la première adresse de x-forwarded-for", () => {
    // Render place le client en tête, puis ses propres relais.
    const request = new Request("http://x", {
      headers: { "x-forwarded-for": "41.85.1.2, 10.0.0.1, 172.16.0.4" },
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
