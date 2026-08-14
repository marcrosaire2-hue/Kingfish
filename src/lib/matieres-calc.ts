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
    fournisseurId: m.fournisseurId ?? null,
    fournisseurNom: m.fournisseurNom ?? null,
    depenseId: m.depenseId ?? null,
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
  const purchases = line.purchases + qty;
  const nextLine = { ...line, purchases };
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
  };

  return {
    lines: lines.map((l) => normalizeMatieresLine(l)),
    movements: [movement, ...movements],
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
