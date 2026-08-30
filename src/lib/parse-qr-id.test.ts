import { describe, expect, it } from "vitest";
import {
  formatStickerCode,
  normalizeStickerCode,
  parseQrIdFromScan,
} from "@/lib/parse-qr-id";

describe("parseQrIdFromScan", () => {
  it("accepte un identifiant KF court", () => {
    expect(parseQrIdFromScan("KF-abc12345")).toBe("KF-ABC12345");
  });

  it("extrait depuis une URL avec paramètre", () => {
    expect(
      parseQrIdFromScan(
        "https://app.example/stock-zogbo?scan=KF-deadbeef",
      ),
    ).toBe("KF-DEADBEEF");
  });

  it("extrait un KF- embarqué dans du texte", () => {
    expect(parseQrIdFromScan("lu: KF-aa11bb22 fin")).toBe("KF-AA11BB22");
  });

  it("accepte le code collé A7K-3Q2", () => {
    expect(parseQrIdFromScan("A7K-3Q2")).toBe("A7K3Q2");
    expect(parseQrIdFromScan("a7k3q2")).toBe("A7K3Q2");
  });

  it("accepte KF- plus le code collé", () => {
    expect(parseQrIdFromScan("KF-A7K3Q2")).toBe("KF-A7K3Q2");
  });

  it("retourne vide pour chaîne vide", () => {
    expect(parseQrIdFromScan("   ")).toBe("");
  });
});

describe("sticker code", () => {
  it("normalise sans tirets ni préfixe KF", () => {
    expect(normalizeStickerCode("a7k-3q2")).toBe("A7K3Q2");
    expect(normalizeStickerCode("KF-A7K3Q2")).toBe("A7K3Q2");
  });

  it("affiche A7K-3Q2", () => {
    expect(formatStickerCode("A7K3Q2")).toBe("A7K-3Q2");
    expect(formatStickerCode("a7k-3q2")).toBe("A7K-3Q2");
  });
});
