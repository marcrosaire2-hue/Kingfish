import { newId } from "@/lib/format";
import type {
  MatieresDay,
  MatieresLine,
  MatieresMovement,
  RawMaterial,
} from "@/lib/types";

export function emptyMatieresLine(
  mat: Pick<RawMaterial, "id" | "name">,
  openingStock = 0,
): MatieresLine {
  return {
    productId: mat.id,
    name: mat.name,
    initialStock: Math.max(0, Number(openingStock) || 0),
    purchases: 0,
    consumed: 0,
    pertes: 0,
    counted: null,
    observations: "",
    unitCost: 0,
  };
}

export function normalizeMatieresLine(
  line: Partial<MatieresLine> & { productId: string; name?: string },
): MatieresLine {
  return {
    productId: line.productId,
    name: String(line.name ?? ""),
    initialStock: Math.max(0, Number(line.initialStock) || 0),
    purchases: Math.max(0, Number(line.purchases) || 0),
    consumed: Math.max(0, Number(line.consumed) || 0),
    pertes: Math.max(0, Number(line.pertes) || 0),
    counted:
      line.counted === null || line.counted === undefined
        ? null
        : Math.max(0, Number(line.counted) || 0),
    observations: String(line.observations ?? ""),
    unitCost: Math.max(0, Number(line.unitCost) || 0),
  };
}

export function normalizeMatieresMovement(
  m: Partial<MatieresMovement> & { id?: string; productId?: string },
): MatieresMovement | null {
  if (!m.id || !m.productId) return null;
  return {
    id: m.id,
    at: m.at || new Date().toISOString(),
    type: m.type === "autre" ? "autre" : "purchase",
    productId: m.productId,
    name: String(m.name ?? ""),
    qty: Math.max(0, Number(m.qty) || 0),
    unitPrice: Math.max(0, Number(m.unitPrice) || 0),
    stockAfter: Math.max(0, Number(m.stockAfter) || 0),
    cancelledAt: m.cancelledAt ?? null,
    editedAt: m.editedAt ?? null,
    fournisseurId: m.fournisseurId ?? null,
    fournisseurNom: m.fournisseurNom ?? null,
    depenseId: m.depenseId ?? null,
    pertes: Math.max(0, Number(m.pertes) || 0),
  };
}

export function stockOf(line: MatieresLine): number {
  return Math.max(
    0,
    line.initialStock +
      line.purchases -
      line.consumed -
      Math.max(0, Number(line.pertes) || 0),
  );
}

export function leftoverFromMatieresLines(
  lines: MatieresLine[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of lines) {
    const n = normalizeMatieresLine(line);
    out.set(
      n.productId,
      n.counted !== null ? n.counted : stockOf(n),
    );
  }
  return out;
}

export function syncMatieresLines(
  lines: MatieresLine[],
  materials: RawMaterial[],
): MatieresLine[] {
  const held = new Map(lines.map((l) => [l.productId, normalizeMatieresLine(l)]));
  return materials.map((m) => {
    const prev = held.get(m.id);
    if (prev) return { ...prev, name: m.name };
    return emptyMatieresLine(m, 0);
  });
}

export function createEmptyMatieresDay(
  date: string,
  materials: RawMaterial[],
  initialByProductId?: Map<string, number>,
): MatieresDay {
  return {
    date,
    status: "ouverte",
    lines: materials.map((m) =>
      emptyMatieresLine(m, initialByProductId?.get(m.id) ?? 0),
    ),
    movements: [],
    updatedAt: null,
  };
}

export function applyMatieresPurchaseToState(
  lines: MatieresLine[],
  movements: MatieresMovement[],
  input: {
    productId: string;
    qty: number;
    unitPrice?: number;
    fournisseurId?: string | null;
    fournisseurNom?: string | null;
  },
): {
  lines: MatieresLine[];
  movements: MatieresMovement[];
  movement: MatieresMovement;
} {
  const qty = Math.max(0, Number(input.qty) || 0);
  if (qty <= 0) throw new Error("Quantité invalide");
  const unitPrice = Math.max(0, Number(input.unitPrice) || 0);
  if (unitPrice <= 0) throw new Error("Prix d'achat obligatoire");

  const idx = lines.findIndex((l) => l.productId === input.productId);
  if (idx < 0) throw new Error("Matière introuvable");

  const line = normalizeMatieresLine(lines[idx]!);
  const prevQty = stockOf(line);
  const incoming = unitPrice;
  const prevCost =
    line.unitCost && line.unitCost > 0 ? line.unitCost : incoming;
  const purchases = line.purchases + qty;
  const nextQty = prevQty + qty;
  const unitCost =
    nextQty > 0 ? (prevQty * prevCost + qty * incoming) / nextQty : incoming;
  const nextLine = { ...line, purchases, unitCost };
  const stockAfter = stockOf(nextLine);

  const movement: MatieresMovement = {
    id: newId("mmvt"),
    at: new Date().toISOString(),
    type: "purchase",
    productId: line.productId,
    name: line.name,
    qty,
    unitPrice,
    stockAfter,
    cancelledAt: null,
    fournisseurId: input.fournisseurId ?? null,
    fournisseurNom: input.fournisseurNom ?? null,
    depenseId: null,
    pertes: 0,
  };

  return {
    lines: lines.map((l, i) =>
      i === idx ? nextLine : normalizeMatieresLine(l),
    ),
    movements: [movement, ...movements],
    movement,
  };
}

/**
 * Achat saisi à la main, hors catalogue des matières : le nom est libre, la
 * quantité et le prix sont obligatoires. Aucune ligne de stock n'est touchée
 * (ces achats n'ont pas de matière au compteur) — ils restent au registre et
 * à l'historique, et le fournisseur/la dépense caisse se comportent comme les
 * autres achats.
 */
export function applyMatieresOtherPurchaseToState(
  lines: MatieresLine[],
  movements: MatieresMovement[],
  input: {
    name: string;
    qty: number;
    unitPrice?: number;
    fournisseurId?: string | null;
    fournisseurNom?: string | null;
  },
): {
  lines: MatieresLine[];
  movements: MatieresMovement[];
  movement: MatieresMovement;
} {
  const name = String(input.name ?? "").trim();
  if (name.length < 2) throw new Error("Nom du produit obligatoire");

  const qty = Math.max(0, Number(input.qty) || 0);
  if (qty <= 0) throw new Error("Quantité invalide");

  const unitPrice = Math.max(0, Number(input.unitPrice) || 0);
  if (unitPrice <= 0) throw new Error("Prix d'achat obligatoire");

  const movement: MatieresMovement = {
    id: newId("mmvt"),
    at: new Date().toISOString(),
    type: "autre",
    productId: "autre",
    name,
    qty,
    unitPrice,
    stockAfter: 0,
    cancelledAt: null,
    fournisseurId: input.fournisseurId ?? null,
    fournisseurNom: input.fournisseurNom ?? null,
    depenseId: null,
    pertes: 0,
  };

  return {
    lines: lines.map((l) => normalizeMatieresLine(l)),
    movements: [movement, ...movements],
    movement,
  };
}

/**
 * Déclare (ou annule, avec `delta` négatif) une perte contre un achat libre
 * précis. Aucune ligne de stock n'est touchée : un achat libre n'en a pas —
 * seul le compteur `pertes` du mouvement varie, comme `pertes` sur une ligne
 * matière.
 */
export function applyMatieresMovementPerteInState(
  movements: MatieresMovement[],
  movementId: string,
  delta: number,
): { movements: MatieresMovement[]; movement: MatieresMovement } {
  const idx = movements.findIndex((m) => m.id === movementId);
  if (idx < 0) throw new Error("Achat introuvable");
  const current = normalizeMatieresMovement(movements[idx]!);
  if (!current) throw new Error("Achat introuvable");
  if (current.type !== "autre") {
    throw new Error("Seul un achat hors catalogue se déclare en perte ici.");
  }
  if (current.cancelledAt) throw new Error("Achat annulé : perte impossible.");

  const pertes = current.pertes + delta;
  if (pertes < 0 || pertes > current.qty) {
    throw new Error(
      `Quantité invalide : reste disponible ${current.qty - current.pertes}.`,
    );
  }

  const movement: MatieresMovement = { ...current, pertes };
  return {
    movements: movements.map((m, i) => (i === idx ? movement : m)),
    movement,
  };
}

export function cancelMatieresMovementInState(
  lines: MatieresLine[],
  movements: MatieresMovement[],
  movementId: string,
): {
  lines: MatieresLine[];
  movements: MatieresMovement[];
} {
  const m = movements.find((x) => x.id === movementId);
  if (!m || m.cancelledAt) throw new Error("Mouvement introuvable ou déjà annulé");

  // Achat libre : aucune ligne de stock à reprendre.
  let linesOut: MatieresLine[];
  if (m.type === "autre") {
    linesOut = lines.map((l) => normalizeMatieresLine(l));
  } else {
    const idx = lines.findIndex((l) => l.productId === m.productId);
    if (idx < 0) throw new Error("Matière introuvable");
    const line = normalizeMatieresLine(lines[idx]!);
    const purchases = Math.max(0, line.purchases - m.qty);
    const nextLine = { ...line, purchases };
    linesOut = lines.map((l, i) =>
      i === idx ? nextLine : normalizeMatieresLine(l),
    );
  }

  return {
    lines: linesOut,
    movements: movements.map((x) =>
      x.id === movementId
        ? { ...x, cancelledAt: new Date().toISOString() }
        : x,
    ),
  };
}

/**
 * Correction d'un achat déjà saisi : quantité, prix, fournisseur, et le nom
 * pour un achat hors catalogue. La ligne garde son identité et son heure de
 * saisie — c'est une correction, pas un nouvel achat.
 *
 * Le stock suit l'écart de quantité : passer 10 kg à 7 kg retire 3 kg des
 * entrées du jour. Un achat annulé ne se corrige pas (il faut le ressaisir),
 * et la matière d'un achat catalogue ne change pas — annuler puis ressaisir
 * reste la voie propre pour ça.
 */
export function editMatieresMovementInState(
  lines: MatieresLine[],
  movements: MatieresMovement[],
  input: {
    movementId: string;
    qty: number;
    unitPrice: number;
    name?: string;
    fournisseurId?: string | null;
    fournisseurNom?: string | null;
  },
): {
  lines: MatieresLine[];
  movements: MatieresMovement[];
  movement: MatieresMovement;
} {
  const current = movements.find((x) => x.id === input.movementId);
  if (!current) throw new Error("Mouvement introuvable");
  if (current.cancelledAt) throw new Error("Achat annulé : correction impossible");

  const qty = Math.max(0, Number(input.qty) || 0);
  if (qty <= 0) throw new Error("Quantité invalide");
  const unitPrice = Math.max(0, Number(input.unitPrice) || 0);
  if (unitPrice <= 0) throw new Error("Prix d'achat obligatoire");

  const previous = normalizeMatieresMovement(current)!;
  const delta = qty - previous.qty;

  let linesOut: MatieresLine[];
  let stockAfter = previous.stockAfter;
  let name = previous.name;

  if (previous.type === "autre") {
    // Achat libre : le nom est saisi à la main, aucune ligne de stock derrière.
    if (qty < previous.pertes) {
      throw new Error(
        `Quantité trop basse : ${previous.pertes} déjà déclaré(s) en perte sur cet achat.`,
      );
    }
    const saisi = String(input.name ?? previous.name).trim();
    if (saisi.length < 2) throw new Error("Nom du produit obligatoire");
    name = saisi;
    stockAfter = 0;
    linesOut = lines.map((l) => normalizeMatieresLine(l));
  } else {
    const idx = lines.findIndex((l) => l.productId === previous.productId);
    if (idx < 0) throw new Error("Matière introuvable");
    const line = normalizeMatieresLine(lines[idx]!);
    const purchases = line.purchases + delta;
    if (purchases < 0) {
      throw new Error(
        "Quantité trop basse : les entrées du jour deviendraient négatives.",
      );
    }
    const nextLine = { ...line, purchases };
    stockAfter = stockOf(nextLine);
    name = line.name;
    linesOut = lines.map((l, i) =>
      i === idx ? nextLine : normalizeMatieresLine(l),
    );
  }

  const movement: MatieresMovement = {
    ...previous,
    name,
    qty,
    unitPrice,
    stockAfter,
    editedAt: new Date().toISOString(),
    fournisseurId: input.fournisseurId ?? null,
    fournisseurNom: input.fournisseurNom ?? null,
  };

  return {
    lines: linesOut,
    movements: movements.map((x) => (x.id === movement.id ? movement : x)),
    movement,
  };
}

export type MatieresLineComputed = MatieresLine & {
  stock: number;
  belowThreshold: boolean;
  threshold: number;
  unit: string;
};

export function computeMatieresDay(
  day: MatieresDay,
  materials: RawMaterial[],
): { lines: MatieresLineComputed[]; alerts: MatieresLineComputed[] } {
  const byId = new Map(materials.map((m) => [m.id, m]));
  const lines = day.lines.map((raw) => {
    const line = normalizeMatieresLine(raw);
    const mat = byId.get(line.productId);
    const stock = stockOf(line);
    const threshold = mat?.threshold ?? 0;
    return {
      ...line,
      stock,
      threshold,
      unit: mat?.unit ?? "",
      belowThreshold: threshold > 0 && stock <= threshold,
    };
  });
  return {
    lines,
    alerts: lines.filter((l) => l.belowThreshold),
  };
}

/**
 * Coût unitaire d’une ligne : CUMP stocké, sinon moyenne des achats du jour,
 * sinon prix catalogue (données anciennes sans historique).
 */
export function unitCostOfMatieresLine(
  line: MatieresLine,
  movements: MatieresMovement[] | undefined,
  catalogPrice: number,
): number {
  const stored = Math.max(0, Number(line.unitCost) || 0);
  if (stored > 0) return stored;
  const purchases = (movements ?? []).filter(
    (m) =>
      m.productId === line.productId &&
      !m.cancelledAt &&
      (m.type === "purchase" || m.type === "autre") &&
      (Number(m.unitPrice) || 0) > 0,
  );
  const qty = purchases.reduce((s, m) => s + (Number(m.qty) || 0), 0);
  const val = purchases.reduce(
    (s, m) => s + (Number(m.qty) || 0) * (Number(m.unitPrice) || 0),
    0,
  );
  if (qty > 0) return val / qty;
  return Math.max(0, Number(catalogPrice) || 0);
}

export function valueMatieresConsumed(
  lines: MatieresLine[] | undefined,
  movements: MatieresMovement[] | undefined,
  catalogPriceById: Map<string, number>,
): number {
  let total = 0;
  for (const raw of lines ?? []) {
    const line = normalizeMatieresLine(raw);
    const consumed = Math.max(0, Number(line.consumed) || 0);
    if (consumed <= 0) continue;
    const cost = unitCostOfMatieresLine(
      line,
      movements,
      catalogPriceById.get(line.productId) ?? 0,
    );
    total += consumed * cost;
  }
  return Math.round(total);
}

export function valueMatieresLinePertes(
  lines: MatieresLine[] | undefined,
  movements: MatieresMovement[] | undefined,
  catalogPriceById: Map<string, number>,
): number {
  let total = 0;
  for (const raw of lines ?? []) {
    const line = normalizeMatieresLine(raw);
    const pertes = Math.max(0, Number(line.pertes) || 0);
    if (pertes <= 0) continue;
    const cost = unitCostOfMatieresLine(
      line,
      movements,
      catalogPriceById.get(line.productId) ?? 0,
    );
    total += pertes * cost;
  }
  return Math.round(total);
}
