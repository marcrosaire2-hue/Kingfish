import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/session", () => ({
  getSessionUser: vi.fn(),
}));

import { getSessionUser } from "@/lib/session";
import { AuthError, requireUser } from "@/lib/api-auth";

describe("authentification API", () => {
  beforeEach(() => {
    vi.mocked(getSessionUser).mockReset();
  });

  it("refuse un appel sans session (401)", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    await expect(requireUser()).rejects.toMatchObject({
      status: 401,
    });
  });

  it("AuthError porte le statut 401 ou 403", () => {
    expect(new AuthError("Non authentifié", 401).status).toBe(401);
    expect(new AuthError("Accès refusé", 403).status).toBe(403);
  });
});
