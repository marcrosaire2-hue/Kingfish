import type {
  BoissonsDay,
  BoissonsLine,
  BoissonsLineComputed,
  BoissonsMovement,
  BoissonsMovementType,
  Drink,
  VenteSite,
} from "@/lib/types";
import { newId } from "@/lib/format";
import { correctionComptage } from "@/lib/stock-comptage";

type LegacyBoissonsLine = Partial<BoissonsLine> & {
  productId: string;
  name: string;
  sold?: number;
  /**
   * Forme historique (avant séparation du stock par site) : un seul pot
   * commun aux deux points de vente. Toujours lue en compatibilité, jamais
   * réécrite sous cette forme.
   */
  initialStock?: number;
  purchases?: number;
  pertes?: number;
  counted?: number | null;
};

/** Défaut : casier grande bouteille */
export const DEFAULT_UNITS_PER_CASIER = 12;

/** Heuristique PB/PM → 24, sinon 12 (GB, etc.) */
export function guessUnitsPerCasier(name: string): number {
  const n = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase();
  if (/\bP[BM]\b/.test(n)) return 24;
  return DEFAULT_UNITS_PER_CASIER;
}

export function unitsPerCasierOf(drink: Drink | undefined | null): number {
  const raw = drink?.unitsPerCasier;
  if (raw !== undefined && raw !== null && Number(raw) > 0) {
    return Math.max(1, Math.round(Number(raw)));
  }
  return drink?.name
    ? guessUnitsPerCasier(drink.name)
    : DEFAULT_UNITS_PER_CASIER;
}

export function normalizeDrink(drink: Drink): Drink {
  return {
    id: drink.id,
    name: drink.name,
    purchasePrice: Math.max(0, Number(drink.purchasePrice) || 0),
    salePrice:
      drink.salePrice === null || drink.salePrice === undefined
        ? null
        : Math.max(0, Number(drink.salePrice) || 0),
    unitsPerCasier: unitsPerCasierOf(drink),
    // Reconstruction champ par champ : sans cette ligne, le seuil saisi dans
    // Paramètres serait perdu au premier enregistrement.
    alertThreshold: Math.max(0, Number(drink.alertThreshold) || 0),
  };
}

/** Affiche une qté en casiers (ex. 1,5) */
export function formatCasiers(value: number): string {
  const n = Math.round(value * 100) / 100;
  if (Number.isInteger(n)) return String(n);
  return n
    .toFixed(2)
    .replace(/0+$/, "")
    .replace(/\.$/, "")
    .replace(".", ",");
}

export function emptyBoissonsLine(
  drink: Drink,
  opening?: { zogbo?: number; gbegamey?: number },
): BoissonsLine {
  return {
    productId: drink.id,
    name: drink.name,
    initialStockZogbo: Number.isFinite(Number(opening?.zogbo)) ? Number(opening?.zogbo) : 0,
    purchasesZogbo: 0,
    soldZogbo: 0,
    pertesZogbo: 0,
    countedZogbo: null,
    initialStockGbegamey: Number.isFinite(Number(opening?.gbegamey)) ? Number(opening?.gbegamey) : 0,
    purchasesGbegamey: 0,
    soldGbegamey: 0,
    pertesGbegamey: 0,
    countedGbegamey: null,
    observations: "",
  };
}

export function normalizeBoissonsLine(line: LegacyBoissonsLine): BoissonsLine {
  const legacySold = Number(line.sold) || 0;
  // Forme héritée : aucun champ *Zogbo n'existe encore sur ce document. La
  // valeur combinée d'origine est alors reflétée à l'identique sur les deux
  // sites (jamais 0 inventé pour l'un d'eux, ce qui bloquerait ses ventes à
  // tort) — la vraie séparation prend le relais dès qu'un comptage propre à
  // un site est saisi, ce que l'écran écrit toujours sous la forme neuve.
  const isLegacy =
    line.initialStockZogbo === undefined &&
    line.purchasesZogbo === undefined &&
    line.pertesZogbo === undefined &&
    line.countedZogbo === undefined;

  const legacyInitial = Math.max(0, Number(line.initialStock) || 0);
  const legacyPurchases = Math.max(0, Number(line.purchases) || 0);
  const legacyPertes = Math.max(0, Number(line.pertes) || 0);
  const legacyCounted =
    line.counted === null || line.counted === undefined
      ? null
      : Math.max(0, Math.round(Number(line.counted) || 0));

  const initialStockZogbo =
    line.initialStockZogbo !== undefined
      ? (Number.isFinite(Number(line.initialStockZogbo)) ? Number(line.initialStockZogbo) : 0)
      : isLegacy
        ? legacyInitial
        : 0;
  const purchasesZogbo =
    line.purchasesZogbo !== undefined
      ? Math.max(0, Number(line.purchasesZogbo) || 0)
      : isLegacy
        ? legacyPurchases
        : 0;
  const pertesZogbo =
    line.pertesZogbo !== undefined
      ? Math.max(0, Number(line.pertesZogbo) || 0)
      : isLegacy
        ? legacyPertes
        : 0;
  const countedZogbo =
    line.countedZogbo !== undefined
      ? line.countedZogbo === null
        ? null
        : Math.max(0, Math.round(Number(line.countedZogbo) || 0))
      : isLegacy
        ? legacyCounted
        : null;

  const initialStockGbegamey =
    line.initialStockGbegamey !== undefined
      ? (Number.isFinite(Number(line.initialStockGbegamey)) ? Number(line.initialStockGbegamey) : 0)
      : isLegacy
        ? legacyInitial
        : 0;
  const purchasesGbegamey =
    line.purchasesGbegamey !== undefined
      ? Math.max(0, Number(line.purchasesGbegamey) || 0)
      : isLegacy
        ? legacyPurchases
        : 0;
  const pertesGbegamey =
    line.pertesGbegamey !== undefined
      ? Math.max(0, Number(line.pertesGbegamey) || 0)
      : isLegacy
        ? legacyPertes
        : 0;
  const countedGbegamey =
    line.countedGbegamey !== undefined
      ? line.countedGbegamey === null
        ? null
        : Math.max(0, Math.round(Number(line.countedGbegamey) || 0))
      : isLegacy
        ? legacyCounted
        : null;

  return {
    productId: line.productId,
    name: line.name,
    initialStockZogbo,
    purchasesZogbo,
    soldZogbo: Math.max(
      0,
      line.soldZogbo !== undefined ? Number(line.soldZogbo) || 0 : legacySold,
    ),
    pertesZogbo,
    countedZogbo,
    initialStockGbegamey,
    purchasesGbegamey,
    soldGbegamey: Math.max(0, Number(line.soldGbegamey) || 0),
    pertesGbegamey,
    countedGbegamey,
    observations: String(line.observations ?? ""),
    ...(line.comptageZogbo ? { comptageZogbo: line.comptageZogbo } : {}),
    ...(line.comptageGbegamey ? { comptageGbegamey: line.comptageGbegamey } : {}),
    // Tri-état préservé (true/false explicites) — seul un champ jamais
    // renseigné (undefined) retombe sur l'inférence historique par
    // comptage. Un `false` explicite ne doit pas disparaître : c'est la
    // seule façon de « dé-suivre » un produit après un comptage périmé.
    ...(line.stockTrackedZogbo === true || line.stockTrackedZogbo === false
      ? { stockTrackedZogbo: line.stockTrackedZogbo }
      : {}),
    ...(line.stockTrackedGbegamey === true ||
    line.stockTrackedGbegamey === false
      ? { stockTrackedGbegamey: line.stockTrackedGbegamey }
      : {}),
  };
}

export function normalizeBoissonsMovement(
  m: Partial<BoissonsMovement> & {
    id?: string;
    type?: string;
    productId?: string;
    name?: string;
  },
): BoissonsMovement | null {
  if (!m.id || !m.productId || m.type !== "purchase") return null;
  return {
    id: m.id,
    at: m.at || new Date().toISOString(),
    type: "purchase",
    productId: m.productId,
    name: String(m.name ?? ""),
    // Mouvement historique sans site : attribué à Zogbo par défaut, comme le
    // reste de la compatibilité ascendante de ce module.
    site: m.site === "gbegamey" ? "gbegamey" : "zogbo",
    qty: Math.max(0, Number(m.qty) || 0),
    stockAfter: Math.max(0, Number(m.stockAfter) || 0),
    cancelledAt: m.cancelledAt ?? null,
  };
}

export function movementTypeLabelBoissons(type: BoissonsMovementType): string {
  return type === "purchase" ? "Achat" : type;
}

export function syncBoissonsLines(
  lines: BoissonsLine[],
  drinks: Drink[],
): BoissonsLine[] {
  const byId = new Map(
    lines.map((l) => [l.productId, normalizeBoissonsLine(l)]),
  );
  return drinks.map((drink) => {
    const existing = byId.get(drink.id);
    if (!existing) return emptyBoissonsLine(drink);
    return { ...existing, name: drink.name };
  });
}

export function createEmptyBoissonsDay(
  date: string,
  drinks: Drink[],
  leftovers?: {
    zogbo?: Map<string, number> | Record<string, number>;
    gbegamey?: Map<string, number> | Record<string, number>;
  },
): BoissonsDay {
  const zogboMap =
    leftovers?.zogbo instanceof Map
      ? leftovers.zogbo
      : new Map(Object.entries(leftovers?.zogbo ?? {}));
  const gbeMap =
    leftovers?.gbegamey instanceof Map
      ? leftovers.gbegamey
      : new Map(Object.entries(leftovers?.gbegamey ?? {}));
  return {
    date,
    status: "ouverte",
    lines: drinks.map((d) =>
      emptyBoissonsLine(d, {
        zogbo: zogboMap.get(d.id) ?? 0,
        gbegamey: gbeMap.get(d.id) ?? 0,
      }),
    ),
    movements: [],
    updatedAt: null,
  };
}

type BoissonsStockFields = Pick<
  BoissonsLine,
  | "initialStockZogbo"
  | "purchasesZogbo"
  | "soldZogbo"
  | "pertesZogbo"
  | "countedZogbo"
  | "comptageZogbo"
  | "initialStockGbegamey"
  | "purchasesGbegamey"
  | "soldGbegamey"
  | "pertesGbegamey"
  | "countedGbegamey"
  | "comptageGbegamey"
>;

/** Ajustement (en casiers) apporté par le comptage du site, 0 sans comptage. */
export function correctionBoissonCasiers(
  line: BoissonsStockFields,
  site: VenteSite,
  upc: number,
): number {
  const z = site === "zogbo";
  const compte = z ? line.countedZogbo : line.countedGbegamey;
  const brut =
    (z ? line.initialStockZogbo : line.initialStockGbegamey) +
    (z ? line.purchasesZogbo : line.purchasesGbegamey) -
    ((z ? line.soldZogbo : line.soldGbegamey) +
      Math.max(0, Number(z ? line.pertesZogbo : line.pertesGbegamey) || 0)) /
      Math.max(1, upc);
  return correctionComptage(
    compte === null || compte === undefined ? null : compte / Math.max(1, upc),
    z ? line.comptageZogbo : line.comptageGbegamey,
    brut,
  );
}

function remainingCasiersForSite(
  line: BoissonsStockFields,
  site: VenteSite,
  upc: number,
): number {
  const initialStock =
    site === "zogbo" ? line.initialStockZogbo : line.initialStockGbegamey;
  const purchases =
    site === "zogbo" ? line.purchasesZogbo : line.purchasesGbegamey;
  const sold = site === "zogbo" ? line.soldZogbo : line.soldGbegamey;
  const available = initialStock + purchases;
  const soldCasiers = sold / Math.max(1, upc);
  return available - soldCasiers + correctionBoissonCasiers(line, site, upc);
}

export function leftoverFromBoissonsLines(
  lines: BoissonsLine[],
  drinks?: Drink[],
  /** Fiches Gbégamey, si elles diffèrent de `drinks` (catalogue par site). */
  drinksGbegamey: Drink[] | undefined = drinks,
  /**
   * `false` garde un reste négatif. Le report vers les jours suivants en a
   * besoin : la caisse peut vendre sur un jour passé des bouteilles achetées
   * un jour suivant (voir `bouteillesAcheteesParBoisson`). Le jour de la
   * vente passe alors sous zéro et le lendemain doit perdre ces bouteilles,
   * sans quoi elles réapparaîtraient en stock.
   */
  options: { plancher?: boolean } = {},
): { zogbo: Map<string, number>; gbegamey: Map<string, number> } {
  const plancher = options.plancher ?? true;
  const borne = (n: number) => (plancher ? Math.max(0, n) : n);
  const drinkById = new Map((drinks ?? []).map((d) => [d.id, d]));
  const gbegameyById = new Map((drinksGbegamey ?? []).map((d) => [d.id, d]));
  const zogbo = new Map<string, number>();
  const gbegamey = new Map<string, number>();
  for (const line of lines) {
    const drinkG = gbegameyById.get(line.productId);
    const computed = computeBoissonsLine(
      line,
      drinkById.get(line.productId),
      drinkG,
    );
    zogbo.set(line.productId, borne(computed.theoreticalRemainingZogbo));
    gbegamey.set(line.productId, borne(computed.theoreticalRemainingGbegamey));
  }
  return { zogbo, gbegamey };
}

export function computeBoissonsLine(
  line: BoissonsLine,
  drink: Drink | undefined,
  /** Fiche Gbégamey ; par défaut la même que `drink` (écran d'un seul site). */
  drinkGbegamey: Drink | undefined = drink,
): BoissonsLineComputed {
  const normalized = normalizeBoissonsLine(line);
  const upc = unitsPerCasierOf(drink);
  const upcGbegamey = unitsPerCasierOf(drinkGbegamey);
  const purchasePrice = drink?.purchasePrice ?? 0;
  const salePrice = drink?.salePrice ?? null;
  const purchasePriceGbegamey = drinkGbegamey?.purchasePrice ?? 0;
  const salePriceGbegamey = drinkGbegamey?.salePrice ?? null;

  const availableZogbo =
    normalized.initialStockZogbo + normalized.purchasesZogbo;
  const availableGbegamey =
    normalized.initialStockGbegamey + normalized.purchasesGbegamey;
  const soldTotal = normalized.soldZogbo + normalized.soldGbegamey;

  const correctionZogbo = correctionBoissonCasiers(normalized, "zogbo", upc);
  const correctionGbegamey = correctionBoissonCasiers(
    normalized,
    "gbegamey",
    upcGbegamey,
  );
  const theoreticalRemainingZogbo =
    availableZogbo -
    normalized.soldZogbo / upc -
    normalized.pertesZogbo / upc +
    correctionZogbo;
  const theoreticalRemainingGbegamey =
    availableGbegamey -
    normalized.soldGbegamey / upcGbegamey -
    normalized.pertesGbegamey / upcGbegamey +
    correctionGbegamey;

  const stockBottlesZogbo = physicalBoissonsStockForSite(
    normalized,
    "zogbo",
    upc,
  );
  const stockBottlesGbegamey = physicalBoissonsStockForSite(
    normalized,
    "gbegamey",
    upcGbegamey,
  );

  const soldAmountZogbo =
    salePrice === null ? 0 : normalized.soldZogbo * salePrice;
  const soldAmountGbegamey =
    salePriceGbegamey === null ? 0 : normalized.soldGbegamey * salePriceGbegamey;
  const soldAmount = soldAmountZogbo + soldAmountGbegamey;
  const marginZogbo =
    salePrice === null ? null : normalized.soldZogbo * (salePrice - purchasePrice);
  const marginGbegamey =
    salePriceGbegamey === null
      ? null
      : normalized.soldGbegamey * (salePriceGbegamey - purchasePriceGbegamey);
  const margin =
    marginZogbo === null && marginGbegamey === null
      ? null
      : (marginZogbo ?? 0) + (marginGbegamey ?? 0);

  // Écart figé au moment du comptage : les ventes suivantes ne le changent pas.
  const varianceZogbo =
    normalized.countedZogbo === null ? null : correctionZogbo;
  const varianceGbegamey =
    normalized.countedGbegamey === null ? null : correctionGbegamey;

  return {
    ...normalized,
    purchasePrice,
    salePrice,
    unitsPerCasier: upc,
    availableZogbo,
    availableGbegamey,
    soldTotal,
    soldAmount,
    soldAmountZogbo,
    soldAmountGbegamey,
    margin,
    theoreticalRemainingZogbo,
    theoreticalRemainingGbegamey,
    stockBottlesZogbo,
    stockBottlesGbegamey,
    varianceZogbo,
    varianceGbegamey,
  };
}

/** Stock restant vendable en bouteilles, pour un seul point de vente. */
export function physicalBoissonsStockForSite(
  line: BoissonsStockFields,
  site: VenteSite,
  unitsPerCasier: number = DEFAULT_UNITS_PER_CASIER,
): number {
  const upc = Math.max(
    1,
    Math.round(unitsPerCasier) || DEFAULT_UNITS_PER_CASIER,
  );
  const initialStock =
    site === "zogbo" ? line.initialStockZogbo : line.initialStockGbegamey;
  const purchases =
    site === "zogbo" ? line.purchasesZogbo : line.purchasesGbegamey;
  const sold = site === "zogbo" ? line.soldZogbo : line.soldGbegamey;
  const pertes = site === "zogbo" ? line.pertesZogbo : line.pertesGbegamey;
  // Le stock vendable part du dernier comptage, puis suit les mouvements.
  const stockBottles = (initialStock + purchases) * upc;
  const bottles =
    stockBottles -
    sold -
    Math.max(0, Number(pertes) || 0) +
    correctionBoissonCasiers(line, site, upc) * upc;
  return Math.round(bottles);
}

/**
 * Stock physique combiné des deux sites — uniquement pour la valorisation
 * du Bilan (patrimoine de l'entreprise dans son ensemble). Ne jamais utiliser
 * pour un affichage caisse/vente : ça reproduirait le pot commun qu'on vient
 * de séparer.
 */
export function physicalBoissonsStockCombined(
  line: Parameters<typeof physicalBoissonsStockForSite>[0],
  unitsPerCasier: number = DEFAULT_UNITS_PER_CASIER,
  unitsPerCasierGbegamey: number = unitsPerCasier,
): number {
  return (
    physicalBoissonsStockForSite(line, "zogbo", unitsPerCasier) +
    physicalBoissonsStockForSite(line, "gbegamey", unitsPerCasierGbegamey)
  );
}

export function applyBoissonsPurchaseToState(
  lines: BoissonsLine[],
  movements: BoissonsMovement[],
  input: {
    productId: string;
    site: VenteSite;
    qty: number;
    unitsPerCasier?: number;
  },
): {
  lines: BoissonsLine[];
  movements: BoissonsMovement[];
  movement: BoissonsMovement;
} {
  // L'achat est saisi en bouteilles sur l'écran et converti en casiers pour
  // le stock interne : on conserve les centièmes (ex. 29 bt = 2,42 casiers).
  const qty = Math.max(0, Math.round((Number(input.qty) || 0) * 100) / 100);
  if (qty <= 0) throw new Error("Quantité invalide");

  const idx = lines.findIndex((l) => l.productId === input.productId);
  if (idx < 0) throw new Error("Boisson introuvable");

  const line = normalizeBoissonsLine(lines[idx]!);
  const upc = Math.max(
    1,
    Math.round(input.unitsPerCasier || DEFAULT_UNITS_PER_CASIER),
  );
  const isZogbo = input.site === "zogbo";
  const purchases =
    (isZogbo ? line.purchasesZogbo : line.purchasesGbegamey) + qty;
  // Comptage ancien (sans repère) : il vaut stock restant, on le relève pour
  // ne pas perdre l'achat. Avec repère, l'achat s'ajoute tout seul au stock.
  const nextLine: BoissonsLine = isZogbo
    ? {
        ...line,
        purchasesZogbo: purchases,
        countedZogbo:
          line.countedZogbo === null || line.comptageZogbo
            ? line.countedZogbo
            : line.countedZogbo + Math.round(qty * upc),
        stockTrackedZogbo: true,
      }
    : {
        ...line,
        purchasesGbegamey: purchases,
        countedGbegamey:
          line.countedGbegamey === null || line.comptageGbegamey
            ? line.countedGbegamey
            : line.countedGbegamey + Math.round(qty * upc),
        stockTrackedGbegamey: true,
      };
  const stockAfter = remainingCasiersForSite(nextLine, input.site, upc);

  const movement: BoissonsMovement = {
    id: newId("bmvt"),
    at: new Date().toISOString(),
    type: "purchase",
    productId: line.productId,
    name: line.name,
    site: input.site,
    qty,
    stockAfter: Math.max(0, Math.round(stockAfter * 100) / 100),
    cancelledAt: null,
  };

  const nextLines = lines.map((l, i) =>
    i === idx ? nextLine : normalizeBoissonsLine(l),
  );

  return {
    lines: nextLines,
    movements: [movement, ...movements],
    movement,
  };
}

export function cancelBoissonsMovementInState(
  lines: BoissonsLine[],
  movements: BoissonsMovement[],
  movementId: string,
  unitsPerCasier: number = DEFAULT_UNITS_PER_CASIER,
): {
  lines: BoissonsLine[];
  movements: BoissonsMovement[];
  movement: BoissonsMovement;
} {
  const target = movements.find((m) => m.id === movementId);
  if (!target) throw new Error("Mouvement introuvable");
  if (target.cancelledAt) throw new Error("Mouvement déjà annulé");

  const idx = lines.findIndex((l) => l.productId === target.productId);
  if (idx < 0) throw new Error("Boisson introuvable");
  const line = normalizeBoissonsLine(lines[idx]!);
  const upc = Math.max(1, Math.round(unitsPerCasier) || DEFAULT_UNITS_PER_CASIER);
  const isZogbo = target.site === "zogbo";

  const purchases = Math.max(
    0,
    (isZogbo ? line.purchasesZogbo : line.purchasesGbegamey) - target.qty,
  );
  // Symétrique de l'achat : seul un comptage sans repère doit être ajusté.
  const nextLine: BoissonsLine = isZogbo
    ? {
        ...line,
        purchasesZogbo: purchases,
        countedZogbo:
          line.countedZogbo === null || line.comptageZogbo
            ? line.countedZogbo
            : Math.max(0, line.countedZogbo - Math.round(target.qty * upc)),
      }
    : {
        ...line,
        purchasesGbegamey: purchases,
        countedGbegamey:
          line.countedGbegamey === null || line.comptageGbegamey
            ? line.countedGbegamey
            : Math.max(0, line.countedGbegamey - Math.round(target.qty * upc)),
      };
  const onHandAfter = remainingCasiersForSite(nextLine, target.site, upc);
  if (onHandAfter < -1e-9) {
    throw new Error(
      "Impossible d’annuler : le stock serait négatif (ventes déjà enregistrées).",
    );
  }

  const cancelled: BoissonsMovement = {
    ...target,
    cancelledAt: new Date().toISOString(),
  };

  const nextLines = lines.map((l, i) =>
    i === idx ? nextLine : normalizeBoissonsLine(l),
  );
  const nextMovements = movements.map((m) =>
    m.id === movementId ? cancelled : m,
  );

  return { lines: nextLines, movements: nextMovements, movement: cancelled };
}

export function computeBoissonsDay(
  day: BoissonsDay,
  drinks: Drink[],
  drinksGbegamey: Drink[] = drinks,
): {
  lines: BoissonsLineComputed[];
  movements: BoissonsMovement[];
  totals: {
    availableZogbo: number;
    availableGbegamey: number;
    purchasesZogbo: number;
    purchasesGbegamey: number;
    sold: number;
    soldZogbo: number;
    soldGbegamey: number;
    soldAmount: number;
    soldAmountZogbo: number;
    soldAmountGbegamey: number;
    margin: number;
    varianceCountZogbo: number;
    varianceCountGbegamey: number;
    missingSalePrice: number;
  };
} {
  const byId = new Map(drinks.map((d) => [d.id, d]));
  const gbegameyById = new Map(drinksGbegamey.map((d) => [d.id, d]));
  const lines = day.lines.map((line) =>
    computeBoissonsLine(
      line,
      byId.get(line.productId),
      gbegameyById.get(line.productId),
    ),
  );
  const movements = (day.movements ?? [])
    .map((m) => normalizeBoissonsMovement(m))
    .filter((m): m is BoissonsMovement => !!m)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  const totals = lines.reduce(
    (acc, l) => {
      acc.availableZogbo += l.availableZogbo;
      acc.availableGbegamey += l.availableGbegamey;
      acc.purchasesZogbo += l.purchasesZogbo;
      acc.purchasesGbegamey += l.purchasesGbegamey;
      acc.sold += l.soldTotal;
      acc.soldZogbo += l.soldZogbo;
      acc.soldGbegamey += l.soldGbegamey;
      acc.soldAmount += l.soldAmount;
      acc.soldAmountZogbo += l.soldAmountZogbo;
      acc.soldAmountGbegamey += l.soldAmountGbegamey;
      if (l.margin !== null) acc.margin += l.margin;
      if (l.varianceZogbo !== null && l.varianceZogbo !== 0) {
        acc.varianceCountZogbo += 1;
      }
      if (l.varianceGbegamey !== null && l.varianceGbegamey !== 0) {
        acc.varianceCountGbegamey += 1;
      }
      if (l.salePrice === null) acc.missingSalePrice += 1;
      return acc;
    },
    {
      availableZogbo: 0,
      availableGbegamey: 0,
      purchasesZogbo: 0,
      purchasesGbegamey: 0,
      sold: 0,
      soldZogbo: 0,
      soldGbegamey: 0,
      soldAmount: 0,
      soldAmountZogbo: 0,
      soldAmountGbegamey: 0,
      margin: 0,
      varianceCountZogbo: 0,
      varianceCountGbegamey: 0,
      missingSalePrice: 0,
    },
  );

  return { lines, movements, totals };
}

/** Reste reporté (casiers) par site et par boisson — voir `leftoverFromBoissonsLines`. */
export type BoissonsLeftover = {
  zogbo: Map<string, number>;
  gbegamey: Map<string, number>;
};

const CARRY_EPSILON = 1e-6;

function roundCasiers(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** Écart de reste (après − avant), par site ; les écarts nuls sont omis. */
export function boissonsLeftoverDelta(
  before: BoissonsLeftover,
  after: BoissonsLeftover,
): BoissonsLeftover {
  const diff = (b: Map<string, number>, a: Map<string, number>) => {
    const out = new Map<string, number>();
    for (const id of new Set([...b.keys(), ...a.keys()])) {
      const d = (a.get(id) ?? 0) - (b.get(id) ?? 0);
      if (Math.abs(d) > CARRY_EPSILON) out.set(id, d);
    }
    return out;
  };
  return {
    zogbo: diff(before.zogbo, after.zogbo),
    gbegamey: diff(before.gbegamey, after.gbegamey),
  };
}

export function isEmptyBoissonsDelta(delta: BoissonsLeftover): boolean {
  return delta.zogbo.size === 0 && delta.gbegamey.size === 0;
}

/**
 * Report d'une correction de reste sur la journée suivante.
 *
 * Une vente, un achat ou une perte saisi après coup sur un jour passé
 * modifie le reste de ce jour ; l'ouverture du jour suivant (créée plus tôt
 * à partir de l'ancien reste) doit bouger d'autant. On ajoute l'écart à
 * l'ouverture, sans écraser une ouverture corrigée à la main.
 *
 * Un comptage saisi sur la journée fige son propre reste (le report se fait
 * depuis le comptage) : l'écart s'arrête là pour ce site et cette boisson.
 */
export function applyBoissonsCarryToDay(
  lines: BoissonsLine[],
  delta: BoissonsLeftover,
): { lines: BoissonsLine[]; next: BoissonsLeftover; changed: boolean } {
  const next: BoissonsLeftover = {
    zogbo: new Map(delta.zogbo),
    gbegamey: new Map(delta.gbegamey),
  };
  let changed = false;
  const out = lines.map((raw) => {
    const line = normalizeBoissonsLine(raw);
    const dz = delta.zogbo.get(line.productId) ?? 0;
    const dg = delta.gbegamey.get(line.productId) ?? 0;
    if (dz === 0 && dg === 0) return raw;
    const patched: BoissonsLine = { ...raw };
    if (dz !== 0) {
      patched.initialStockZogbo = roundCasiers(line.initialStockZogbo + dz);
      if (line.countedZogbo !== null) {
        next.zogbo.delete(line.productId);
        if (line.comptageZogbo) {
          patched.comptageZogbo = {
            ...line.comptageZogbo,
            theorique: roundCasiers(line.comptageZogbo.theorique + dz),
          };
        }
      }
    }
    if (dg !== 0) {
      patched.initialStockGbegamey = roundCasiers(line.initialStockGbegamey + dg);
      if (line.countedGbegamey !== null) {
        next.gbegamey.delete(line.productId);
        if (line.comptageGbegamey) {
          patched.comptageGbegamey = {
            ...line.comptageGbegamey,
            theorique: roundCasiers(line.comptageGbegamey.theorique + dg),
          };
        }
      }
    }
    if (
      patched.initialStockZogbo !== raw.initialStockZogbo ||
      patched.initialStockGbegamey !== raw.initialStockGbegamey
    ) {
      changed = true;
    }
    return patched;
  });
  return { lines: out, next, changed };
}

/**
 * Mouvement net en bouteilles, par boisson, sur un ensemble de journées et
 * pour un site : achats − ventes − pertes. Sert à la caisse restée ouverte
 * sur un jour passé : un achat saisi au stock sur un jour suivant (souvent
 * aujourd'hui) doit être vendable tout de suite, sans attendre la bascule,
 * et une perte ou une vente déjà portée sur ces jours-là doit être retirée.
 */
export function bouteillesAcheteesParBoisson(
  jours: BoissonsLine[][],
  site: VenteSite,
  drinks: Drink[],
): Map<string, number> {
  const upcById = new Map(
    drinks.map((d) => [
      d.id,
      Math.max(1, Math.round(Number(d.unitsPerCasier) || DEFAULT_UNITS_PER_CASIER)),
    ]),
  );
  const total = new Map<string, number>();
  for (const lignes of jours) {
    for (const brute of lignes) {
      const line = normalizeBoissonsLine(brute);
      const z = site === "zogbo";
      const casiers = z ? line.purchasesZogbo : line.purchasesGbegamey;
      const vendus = z ? line.soldZogbo : line.soldGbegamey;
      const pertes = Math.max(0, Number(z ? line.pertesZogbo : line.pertesGbegamey) || 0);
      const upc = upcById.get(line.productId) ?? DEFAULT_UNITS_PER_CASIER;
      const net = casiers * upc - vendus - pertes;
      if (net === 0) continue;
      total.set(line.productId, (total.get(line.productId) ?? 0) + net);
    }
  }
  for (const [id, n] of total) total.set(id, Math.round(n));
  return total;
}
