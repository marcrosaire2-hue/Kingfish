import { describe, expect, it } from "vitest";
import { parseQrIdFromScan } from "@/lib/parse-qr-id";

describe("parseQrIdFromScan", () => {
  it("accepte un identifiant direct", () => {
    expect(parseQrIdFromScan("KF-abc12345")).toBe("KF-abc12345");
  });

  it("extrait depuis une URL avec paramètre", () => {
    expect(
      parseQrIdFromScan(
        "https://app.example/stock-zogbo?scan=KF-deadbeef",
      ),
    ).toBe("KF-deadbeef");
  });

  it("extrait un KF- embarqué dans du texte", () => {
    expect(parseQrIdFromScan("lu: KF-aa11bb22 fin")).toBe("KF-aa11bb22");
  });

  it("retourne vide pour chaîne vide", () => {
    expect(parseQrIdFromScan("   ")).toBe("");
  });
});
