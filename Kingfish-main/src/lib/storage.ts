import { SEED_PARAMETRES } from "./seed-parametres";
import type { Parametres } from "./types";

export const PARAMETRES_STORAGE_KEY = "gestion.parametres.v1";

export function cloneSeed(): Parametres {
  return structuredClone(SEED_PARAMETRES);
}

export function loadParametres(): Parametres {
  if (typeof window === "undefined") return cloneSeed();
  try {
    const raw = window.localStorage.getItem(PARAMETRES_STORAGE_KEY);
    if (!raw) return cloneSeed();
    const parsed = JSON.parse(raw) as Parametres;
    if (
      !parsed ||
      !Array.isArray(parsed.baseDishes) ||
      !Array.isArray(parsed.drinks) ||
      !Array.isArray(parsed.localDishes)
    ) {
      return cloneSeed();
    }
    return parsed;
  } catch {
    return cloneSeed();
  }
}

export function saveParametres(data: Parametres): void {
  const payload: Parametres = {
    ...data,
    updatedAt: new Date().toISOString(),
  };
  window.localStorage.setItem(PARAMETRES_STORAGE_KEY, JSON.stringify(payload));
}
