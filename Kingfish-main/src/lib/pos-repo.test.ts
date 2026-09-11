import { describe, expect, it } from "vitest";
import { formatTicketNumero } from "@/lib/pos-repo";

describe("formatTicketNumero", () => {
  it("compose AAMMJJ à partir de la date ISO", () => {
    expect(formatTicketNumero("2026-08-12", 1)).toBe("T-260812-001");
  });

  it("complète le compteur sur 3 chiffres", () => {
    expect(formatTicketNumero("2026-08-12", 42)).toBe("T-260812-042");
  });

  it("ne tronque pas au-delà de 3 chiffres", () => {
    expect(formatTicketNumero("2026-08-12", 1000)).toBe("T-260812-1000");
  });
});
