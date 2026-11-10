import type { StockBalance } from "@/lib/stock-ledger";
import type { VenteSite } from "@/lib/types";

/**
 * Magasin, fiches de composition et production : calculs purs.
 *
 * Trois étapes : les achats entrent au magasin ; une production « en lot »
 * transforme des ingrédients en portions ; une vente retire des portions, ou
 * directement les ingrédients pour une fiche « à la commande ». Un manque
 * déclaré n'est pas retiré du stock, et ne bloque jamais une vente.
 */

/** Sites où le magasin est actif. Zogbo viendra ensuite. */
export const MAGASIN_SITES: readonly VenteSite[] = ["gbegamey"];

export function magasinActif(site: VenteSite): boolean {
  return MAGASIN_SITES.includes(site);
}

export type MagasinUnit = "kg" | "L" | "u";

export const MAGASIN_UNITS: readonly MagasinUnit[] = ["kg", "L", "u"];

export function isMagasinUnit(value: unknown): value is MagasinUnit {
  return value === "kg" || value === "L" || value === "u";
}

/** Unité de saisie des recettes : grammes et millilitres. */
export function uniteRecette(unit: MagasinUnit): "g" | "mL" | "u" {
  if (unit === "kg") return "g";
  if (unit === "L") return "mL";
  return "u";
}

export function recetteVersBase(qty: number, unit: MagasinUnit): number {
  return unit === "u" ? qty : qty / 1000;
}

export function baseVersRecette(qty: number, unit: MagasinUnit): number {
  return unit === "u" ? qty : round4(qty * 1000);
}

export type MagasinArticle = {
  id: string;
  site: VenteSite;
  name: string;
  unit: MagasinUnit;
  /** Prix d'achat d'une unité (kg, L ou pièce), pour priorité et valeur. */
  unitPrice: number;
  /** Seuil d'alerte, dans l'unité de l'article. */
  threshold: number;
  active: boolean;
};

export type FicheMode = "lot" | "commande";
export type FicheProductKind = "plat" | "local";

export type FicheLine = {
  articleId: string;
  /** Dans l'unité de l'article : par lot, ou par portion « à la commande ». */
  qty: number;
  /** Supplément : retiré seulement si le caissier le coche. */
  supplement: boolean;
};

export type Fiche = {
  id: string;
  site: VenteSite;
  productKind: FicheProductKind;
  productId: string;
  productName: string;
  mode: FicheMode;
  /** Portions obtenues avec un lot (mode « lot » seulement). */
  portions: number;
  lines: FicheLine[];
  updatedAt: string | null;
};

export function ficheId(
  site: VenteSite,
  productKind: FicheProductKind,
  productId: string,
): string {
  return `${site}:${productKind}:${productId}`;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function positive(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Valide une fiche saisie : refuse plutôt que de corriger en silence. */
export function normalizeFiche(
  input: {
    site: VenteSite;
    productKind: unknown;
    productId: unknown;
    productName: unknown;
    mode: unknown;
    portions?: unknown;
    lines: unknown;
  },
  articles: readonly Pick<MagasinArticle, "id">[],
): Omit<Fiche, "updatedAt"> {
  const productKind = input.productKind;
  if (productKind !== "plat" && productKind !== "local") {
    throw new Error("Produit invalide.");
  }
  const productId = String(input.productId ?? "").trim();
  const productName = String(input.productName ?? "").trim();
  if (!productId || !productName) throw new Error("Produit invalide.");
  const mode = input.mode;
  if (mode !== "lot" && mode !== "commande") {
    throw new Error("Choisissez « en lot » ou « à la commande ».");
  }
  const portions = mode === "lot" ? positive(input.portions) : 0;
  if (mode === "lot" && portions <= 0) {
    throw new Error("Indiquez le nombre de portions obtenues par lot.");
  }
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new Error("Ajoutez au moins un ingrédient.");
  }
  const known = new Set(articles.map((a) => a.id));
  const seen = new Set<string>();
  const lines: FicheLine[] = input.lines.map((raw) => {
    const line = raw as Partial<FicheLine>;
    const articleId = String(line?.articleId ?? "");
    if (!known.has(articleId)) throw new Error("Ingrédient inconnu.");
    if (seen.has(articleId)) {
      throw new Error("Un ingrédient ne peut figurer qu'une fois par fiche.");
    }
    seen.add(articleId);
    const qty = positive(line?.qty);
    if (qty <= 0) throw new Error("Chaque ingrédient doit avoir une quantité.");
    return { articleId, qty, supplement: line?.supplement === true };
  });
  return {
    id: ficheId(input.site, productKind, productId),
    site: input.site,
    productKind,
    productId,
    productName,
    mode,
    portions,
    lines,
  };
}

/** Exceptions saisies à la caisse pour une ligne de vente. */
export type VenteAjustements = {
  /** Ingrédients absents (fiche à la commande) : nombre de plats concernés. */
  manquants?: Array<{ articleId: string; qty: number }>;
  /** Portions absentes (fiche en lot) : nombre de portions non servies. */
  portionsManquantes?: number;
  /** Suppléments cochés : nombre de plats concernés. */
  supplements?: Array<{ articleId: string; qty: number }>;
};

function quantiteBornee(value: unknown, max: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, max);
}

function indexer(
  list: VenteAjustements["manquants"],
): Map<string, unknown> {
  return new Map((Array.isArray(list) ? list : []).map((x) => [x?.articleId, x?.qty]));
}

export type ConsommationLigne = {
  family: "magasin" | "portion";
  itemId: string;
  qty: number;
};

export type ConsommationVente = {
  lignes: ConsommationLigne[];
  manquants: Array<{ family: "magasin" | "portion"; itemId: string; qty: number }>;
};

/**
 * Ce qu'une vente retire du stock. Les quantités saisies sont bornées au
 * nombre de plats vendus : un envoi incohérent ne peut pas fausser le stock.
 */
export function computeConsommationVente(input: {
  fiche: Fiche;
  qty: number;
  ajustements?: VenteAjustements | null;
}): ConsommationVente {
  const { fiche } = input;
  const vendus = Math.abs(Math.round(Number(input.qty) || 0));
  const lignes: ConsommationLigne[] = [];
  const manquants: ConsommationVente["manquants"] = [];
  if (vendus === 0) return { lignes, manquants };

  const absents = indexer(input.ajustements?.manquants);
  const choisis = indexer(input.ajustements?.supplements);

  if (fiche.mode === "lot") {
    const absentes = quantiteBornee(input.ajustements?.portionsManquantes, vendus);
    if (vendus - absentes > 0) {
      lignes.push({ family: "portion", itemId: fiche.id, qty: vendus - absentes });
    }
    if (absentes > 0) {
      manquants.push({ family: "portion", itemId: fiche.id, qty: absentes });
    }
  }

  for (const line of fiche.lines) {
    if (line.supplement) {
      const nombre = quantiteBornee(choisis.get(line.articleId), vendus);
      if (nombre > 0) {
        lignes.push({
          family: "magasin",
          itemId: line.articleId,
          qty: round4(line.qty * nombre),
        });
      }
      continue;
    }
    // En lot, les ingrédients sont sortis à la production.
    if (fiche.mode === "lot") continue;
    const absent = quantiteBornee(absents.get(line.articleId), vendus);
    if (vendus - absent > 0) {
      lignes.push({
        family: "magasin",
        itemId: line.articleId,
        qty: round4(line.qty * (vendus - absent)),
      });
    }
    if (absent > 0) {
      manquants.push({ family: "magasin", itemId: line.articleId, qty: absent });
    }
  }
  return { lignes, manquants };
}

/** Retire de l'envoi navigateur tout ce qui n'est pas une exception utile. */
export function normalizeAjustements(
  raw: unknown,
): VenteAjustements | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const source = raw as VenteAjustements;
  const liste = (list: unknown) =>
    (Array.isArray(list) ? list : [])
      .map((x: { articleId?: unknown; qty?: unknown }) => ({
        articleId: String(x?.articleId ?? ""),
        qty: Math.round(Number(x?.qty) || 0),
      }))
      .filter((x) => x.articleId && x.qty > 0);
  const manquants = liste(source.manquants);
  const supplements = liste(source.supplements);
  const portionsManquantes = Math.max(
    0,
    Math.round(Number(source.portionsManquantes) || 0),
  );
  if (!manquants.length && !supplements.length && !portionsManquantes) {
    return undefined;
  }
  return {
    ...(manquants.length ? { manquants } : {}),
    ...(supplements.length ? { supplements } : {}),
    ...(portionsManquantes ? { portionsManquantes } : {}),
  };
}

export type ProductionSaisie = {
  articleId: string;
  /** Ingrédient absent : rien n'est retiré du magasin. */
  manquant?: boolean;
  /** Quantité réelle ; absente, la quantité prévue s'applique. */
  reel?: number | null;
};

export type ProductionCalcul = {
  lignes: Array<{ articleId: string; prevu: number; reel: number; manquant: boolean }>;
  portionsTheoriques: number;
  portions: number;
  /** Portions obtenues − portions attendues (négatif : rendement faible). */
  ecartPortions: number;
};

/** Sortie d'ingrédients et portions obtenues pour une production en lot. */
export function computeProduction(input: {
  fiche: Fiche;
  lots: number;
  portions?: number | null;
  saisies?: readonly ProductionSaisie[];
}): ProductionCalcul {
  const { fiche } = input;
  if (fiche.mode !== "lot") {
    throw new Error("Cette fiche est préparée à la commande.");
  }
  const lots = positive(input.lots);
  if (lots <= 0) throw new Error("Indiquez le nombre de lots préparés.");

  const saisies = new Map((input.saisies ?? []).map((s) => [s.articleId, s]));
  const lignes = fiche.lines
    .filter((line) => !line.supplement)
    .map((line) => {
      const prevu = round4(line.qty * lots);
      const saisie = saisies.get(line.articleId);
      if (saisie?.manquant) {
        return { articleId: line.articleId, prevu, reel: 0, manquant: true };
      }
      const brut = saisie?.reel;
      const valeur =
        brut === null || brut === undefined ? Number.NaN : Number(brut);
      if (Number.isFinite(valeur) && valeur < 0) {
        throw new Error("Une quantité réelle ne peut pas être négative.");
      }
      return {
        articleId: line.articleId,
        prevu,
        reel: Number.isFinite(valeur) ? round4(valeur) : prevu,
        manquant: false,
      };
    });

  const portionsTheoriques = round4(fiche.portions * lots);
  const saisiesPortions =
    input.portions === null || input.portions === undefined
      ? Number.NaN
      : Number(input.portions);
  if (Number.isFinite(saisiesPortions) && saisiesPortions < 0) {
    throw new Error("Le nombre de portions ne peut pas être négatif.");
  }
  const portions = Number.isFinite(saisiesPortions)
    ? round4(saisiesPortions)
    : portionsTheoriques;
  return {
    lignes,
    portionsTheoriques,
    portions,
    ecartPortions: round4(portions - portionsTheoriques),
  };
}

/** Consommation nette déjà enregistrée pour une vente, par élément. */
export function consommationNette(
  events: ReadonlyArray<{
    family: string;
    productId: string;
    type: string;
    qty: number;
  }>,
): Map<string, { family: string; productId: string; net: number }> {
  const out = new Map<string, { family: string; productId: string; net: number }>();
  for (const event of events) {
    const key = `${event.family}|${event.productId}`;
    const row = out.get(key) ?? {
      family: event.family,
      productId: event.productId,
      net: 0,
    };
    row.net = round4(row.net + (event.type === "annulation" ? -event.qty : event.qty));
    out.set(key, row);
  }
  return out;
}

const JOUR_MS = 86_400_000;
const JOURS_MAX = 30;

/**
 * Articles à compter aujourd'hui : d'abord les jamais comptés et les plus
 * anciens, avec priorité aux stocks de valeur et aux écarts déjà constatés.
 * Un article compté aujourd'hui sort de la liste.
 */
export function choisirComptages(input: {
  articles: readonly MagasinArticle[];
  balances: ReadonlyMap<string, Pick<StockBalance, "stock" | "lastEcart" | "lastCountAt">>;
  today: string;
  limit?: number;
}): string[] {
  const ref = Date.parse(`${input.today}T12:00:00Z`);
  const lignes = input.articles
    .filter((a) => a.active)
    .map((a) => {
      const b = input.balances.get(a.id);
      const compteAt = b?.lastCountAt ?? null;
      const jours = compteAt
        ? Math.min(JOURS_MAX, Math.max(0, (ref - Date.parse(compteAt)) / JOUR_MS))
        : JOURS_MAX;
      const valeur = Math.abs(b?.stock ?? 0) * a.unitPrice;
      const ecart = Math.abs(b?.lastEcart ?? 0) * a.unitPrice;
      return {
        id: a.id,
        name: a.name,
        compteAujourdhui: Boolean(compteAt && compteAt.slice(0, 10) === input.today),
        score: jours * (1 + valeur / 1000) + ecart / 100,
      };
    })
    .filter((l) => !l.compteAujourdhui)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "fr"));
  return lignes.slice(0, input.limit ?? 5).map((l) => l.id);
}

export type ManquantRow = {
  family: "magasin" | "portion";
  itemId: string;
  name: string;
  qty: number;
  /** Stock théorique au moment de la déclaration. */
  stockAuMoment: number;
};

export type ManquantSynthese = {
  itemId: string;
  family: "magasin" | "portion";
  name: string;
  declarations: number;
  qty: number;
  avecStock: number;
  /** Déclaré manquant plusieurs fois alors que le stock indiquait du disponible. */
  alerte: boolean;
};

const SEUIL_ALERTE_MANQUANT = 3;

export function syntheseManquants(
  rows: readonly ManquantRow[],
): ManquantSynthese[] {
  const out = new Map<string, ManquantSynthese>();
  for (const row of rows) {
    const key = `${row.family}|${row.itemId}`;
    const s = out.get(key) ?? {
      itemId: row.itemId,
      family: row.family,
      name: row.name,
      declarations: 0,
      qty: 0,
      avecStock: 0,
      alerte: false,
    };
    s.declarations += 1;
    s.qty += row.qty;
    if (row.stockAuMoment > 0) s.avecStock += 1;
    s.alerte = s.avecStock >= SEUIL_ALERTE_MANQUANT;
    out.set(key, s);
  }
  return [...out.values()].sort(
    (a, b) =>
      Number(b.alerte) - Number(a.alerte) ||
      b.declarations - a.declarations ||
      a.name.localeCompare(b.name, "fr"),
  );
}
