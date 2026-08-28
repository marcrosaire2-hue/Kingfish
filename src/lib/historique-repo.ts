import { ObjectId } from "mongodb";
import { isBackdatedRecord } from "@/lib/datetime-fr";
import { isValidDate } from "@/lib/day-doc";
import { formatFcfa } from "@/lib/format";
import { filterRegularisationEvents } from "@/lib/historique-filters";
import { getDb } from "@/lib/mongodb";
import type { VenteKind, VenteSite } from "@/lib/types";
import type {
  HistoriqueAction,
  HistoriqueActor,
  HistoriqueEvent,
  HistoriqueKind,
  HistoriqueSite,
} from "@/lib/historique-types";
import { VENTE_SOURCE_REGULARISATION } from "@/lib/historique-types";

export type {
  HistoriqueActor,
  HistoriqueEvent,
  HistoriqueKind,
  HistoriqueSite,
} from "@/lib/historique-types";
export {
  HISTORIQUE_KIND_LABELS,
  formatActorLabel,
} from "@/lib/historique-types";

type HistoriqueDoc = {
  _id: ObjectId;
  at: string;
  date: string | null;
  kind: Exclude<HistoriqueKind, "vente">;
  site: HistoriqueSite;
  title: string;
  detail: string;
  actorId: string | null;
  actorName: string | null;
  actorUsername: string | null;
  amount: number | null;
  action?: HistoriqueAction | null;
  productName?: string | null;
  qty?: number | null;
  previousQty?: number | null;
  unitPrice?: number | null;
  ticketNumero?: string | null;
  venteLogId?: string | null;
  regularisation?: boolean | null;
};

type VenteLogDoc = {
  _id: ObjectId;
  date: string;
  site: VenteSite;
  kind: VenteKind;
  productId: string;
  name: string;
  qty: number;
  unitPrice: number;
  amount: number;
  at: string;
  source?: string | null;
  cancelledAt?: string | null;
  actorId?: string | null;
  actorName?: string | null;
  actorUsername?: string | null;
  cancelledById?: string | null;
  cancelledByName?: string | null;
  cancelledByUsername?: string | null;
};

const KIND_VENTE: Record<VenteKind, string> = {
  plat: "Plat",
  local: "Accompagnement",
  boisson: "Boisson",
  combo: "Combo",
  extra: "Extra",
};

function inferActionFromTitle(title: string): HistoriqueAction | null {
  const t = title.toLowerCase();
  if (t.startsWith("modification ·") || t.startsWith("modification ")) {
    return "modification";
  }
  if (t.includes("suppression définitive")) return "suppression";
  if (t.startsWith("annulation ticket") || t.includes("annulation ticket")) {
    return "annulation";
  }
  if (t.startsWith("ticket pos")) return "ajout";
  if (t.startsWith("purge ventes")) return "suppression";
  return null;
}

function isRegularisationVente(doc: VenteLogDoc, atIso: string): boolean {
  return (
    doc.source === VENTE_SOURCE_REGULARISATION ||
    isBackdatedRecord(doc.date, atIso)
  );
}

function eventMeta(doc: {
  at: string;
  date: string | null;
  action?: HistoriqueAction | null;
  productName?: string | null;
  qty?: number | null;
  previousQty?: number | null;
  unitPrice?: number | null;
  ticketNumero?: string | null;
  venteLogId?: string | null;
  regularisation?: boolean | null;
}): Pick<
  HistoriqueEvent,
  | "action"
  | "productName"
  | "qty"
  | "previousQty"
  | "unitPrice"
  | "ticketNumero"
  | "venteLogId"
  | "regularisation"
  | "saisiTardif"
> {
  return {
    action: doc.action ?? null,
    productName: doc.productName ?? null,
    qty: doc.qty ?? null,
    previousQty: doc.previousQty ?? null,
    unitPrice: doc.unitPrice ?? null,
    ticketNumero: doc.ticketNumero ?? null,
    venteLogId: doc.venteLogId ?? null,
    regularisation: !!doc.regularisation,
    saisiTardif: doc.date ? isBackdatedRecord(doc.date, doc.at) : false,
  };
}

function toEvent(doc: HistoriqueDoc): HistoriqueEvent {
  const action = doc.action ?? inferActionFromTitle(doc.title);
  return {
    id: doc._id.toHexString(),
    at: doc.at,
    date: doc.date,
    kind: doc.kind,
    site: doc.site,
    title: doc.title,
    detail: doc.detail,
    actorId: doc.actorId,
    actorName: doc.actorName,
    actorUsername: doc.actorUsername ?? null,
    amount: doc.amount,
    ...eventMeta({ ...doc, action }),
  };
}

function venteDetail(doc: VenteLogDoc): string {
  const zone = doc.site === "zogbo" ? "Zogbo" : "Gbégamey";
  const kindLabel = KIND_VENTE[doc.kind] ?? doc.kind;
  return `${Math.abs(doc.qty)} × ${doc.name} · PU ${formatFcfa(doc.unitPrice)} · ${kindLabel} · ${zone}`;
}

function venteToEvent(doc: VenteLogDoc): HistoriqueEvent {
  const venteLogId = doc._id.toHexString();
  if (doc.cancelledAt) {
    const regularisation = isRegularisationVente(doc, doc.cancelledAt);
    return {
      id: `vente-annul-${venteLogId}`,
      at: doc.cancelledAt,
      date: doc.date,
      kind: "vente_annulee",
      site: doc.site,
      title: regularisation
        ? `Annulation régularisation · ${doc.name}`
        : `Annulation · ${doc.name}`,
      detail: venteDetail(doc),
      actorId: doc.cancelledById ?? doc.actorId ?? null,
      actorName: doc.cancelledByName ?? doc.actorName ?? null,
      actorUsername: doc.cancelledByUsername ?? doc.actorUsername ?? null,
      amount: -Math.abs(doc.amount),
      action: "annulation",
      productName: doc.name,
      qty: Math.abs(doc.qty),
      unitPrice: doc.unitPrice,
      venteLogId,
      regularisation,
      saisiTardif: isBackdatedRecord(doc.date, doc.cancelledAt),
    };
  }

  const regularisation = isRegularisationVente(doc, doc.at);
  return {
    id: `vente-${venteLogId}`,
    at: doc.at,
    date: doc.date,
    kind: "vente",
    site: doc.site,
    title: regularisation
      ? `Régularisation · ${doc.name}`
      : `Ajout · ${doc.name}`,
    detail: venteDetail(doc),
    actorId: doc.actorId ?? null,
    actorName: doc.actorName ?? null,
    actorUsername: doc.actorUsername ?? null,
    amount: doc.amount,
    action: "ajout",
    productName: doc.name,
    qty: Math.abs(doc.qty),
    unitPrice: doc.unitPrice,
    venteLogId,
    regularisation,
    saisiTardif: isBackdatedRecord(doc.date, doc.at),
  };
}

export async function appendHistorique(input: {
  kind: Exclude<HistoriqueKind, "vente">;
  title: string;
  detail: string;
  date?: string | null;
  site?: HistoriqueSite;
  amount?: number | null;
  actor?: HistoriqueActor | null;
  action?: HistoriqueAction | null;
  productName?: string | null;
  qty?: number | null;
  previousQty?: number | null;
  unitPrice?: number | null;
  ticketNumero?: string | null;
  venteLogId?: string | null;
  regularisation?: boolean | null;
}): Promise<HistoriqueEvent> {
  const at = new Date().toISOString();
  const doc: HistoriqueDoc = {
    _id: new ObjectId(),
    at,
    date: input.date ?? null,
    kind: input.kind,
    site: input.site ?? null,
    title: input.title,
    detail: input.detail,
    actorId: input.actor?.id ?? null,
    actorName: input.actor?.name ?? null,
    actorUsername: input.actor?.username ?? null,
    amount: input.amount ?? null,
    action: input.action ?? null,
    productName: input.productName ?? null,
    qty: input.qty ?? null,
    previousQty: input.previousQty ?? null,
    unitPrice: input.unitPrice ?? null,
    ticketNumero: input.ticketNumero ?? null,
    venteLogId: input.venteLogId ?? null,
    regularisation: input.regularisation ?? null,
  };
  const db = await getDb();
  await db.collection<HistoriqueDoc>("historique").insertOne(doc);
  return toEvent(doc);
}

function buildRecordedAtFilter(from: string | null, to: string | null) {
  const atRange: Record<string, string> = {};
  if (from) atRange.$gte = `${from}T00:00:00.000Z`;
  if (to) atRange.$lte = `${to}T23:59:59.999Z`;
  return { $or: [{ at: atRange }, { cancelledAt: atRange }] };
}

export async function listHistorique(input: {
  from?: string;
  to?: string;
  kind?: HistoriqueKind | "all";
  site?: VenteSite | "all";
  actorId?: string;
  q?: string;
  limit?: number;
  origin?: "all" | "regularisation";
}): Promise<{ events: HistoriqueEvent[]; total: number }> {
  const limit = Math.min(Math.max(input.limit ?? 200, 1), 500);
  const kind = input.kind ?? "all";
  const site = input.site ?? "all";
  const origin = input.origin ?? "all";
  const actorId = input.actorId?.trim() || "";
  const q = input.q?.trim().toLowerCase() || "";

  const from = input.from && isValidDate(input.from) ? input.from : null;
  const to = input.to && isValidDate(input.to) ? input.to : null;

  const db = await getDb();

  const histFilter: Record<string, unknown> = {};
  if (from || to) {
    histFilter.at = {};
    if (from) {
      (histFilter.at as Record<string, string>).$gte = `${from}T00:00:00.000Z`;
    }
    if (to) {
      (histFilter.at as Record<string, string>).$lte = `${to}T23:59:59.999Z`;
    }
  }
  if (kind !== "all" && kind !== "vente" && kind !== "vente_annulee") {
    histFilter.kind = kind;
  }
  if (site !== "all") {
    histFilter.site = site;
  }
  if (actorId) {
    histFilter.actorId = actorId;
  }

  const venteClauses: Record<string, unknown>[] = [];
  if (from || to) {
    venteClauses.push(buildRecordedAtFilter(from, to));
  }
  if (site !== "all") {
    venteClauses.push({ site });
  }
  if (actorId) {
    venteClauses.push({
      $or: [{ actorId }, { cancelledById: actorId }],
    });
  }
  const venteFilter: Record<string, unknown> =
    venteClauses.length === 0
      ? {}
      : venteClauses.length === 1
        ? venteClauses[0]
        : { $and: venteClauses };

  const includeVentes =
    kind === "all" || kind === "vente" || kind === "vente_annulee";
  const includeHist =
    kind === "all" || (kind !== "vente" && kind !== "vente_annulee");

  const [histDocs, venteDocs] = await Promise.all([
    includeHist
      ? db
          .collection<HistoriqueDoc>("historique")
          .find(histFilter)
          .sort({ at: -1 })
          .limit(limit * 2)
          .toArray()
      : Promise.resolve([] as HistoriqueDoc[]),
    includeVentes
      ? db
          .collection<VenteLogDoc>("ventes_log")
          .find(venteFilter)
          .sort({ at: -1 })
          .limit(limit * 2)
          .toArray()
      : Promise.resolve([] as VenteLogDoc[]),
  ]);

  let events: HistoriqueEvent[] = [
    ...(includeHist ? histDocs.map(toEvent) : []),
    ...(includeVentes ? venteDocs.map(venteToEvent) : []),
  ];

  if (kind !== "all") {
    events = events.filter((e) => e.kind === kind);
  }

  if (q) {
    events = events.filter((e) => {
      const hay = [
        e.title,
        e.detail,
        e.productName ?? "",
        e.ticketNumero ?? "",
        e.venteLogId ?? "",
        e.actorName ?? "",
        e.actorUsername ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }

  if (origin === "regularisation") {
    events = filterRegularisationEvents(events);
  }

  events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const sliced = events.slice(0, limit);

  return { events: sliced, total: sliced.length };
}
