import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Même alias que tsconfig, pour que les tests importent comme l'application.
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Les restrictions de planning sont désactivées par défaut en production ;
    // les tests existants vérifient leur logique, donc ils les activent.
    env: { PLANNING_RESTRICTIONS: "on" },
  },
});
