import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { VenteKind, VenteSite } from "@/lib/types";
import type {
  HistoriqueActor,
  HistoriqueEvent,
  HistoriqueKind,
  HistoriqueSite,
} from "@/lib/historique-types";
import { isValidDate } from "@/lib/day-doc";

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
  cancelledAt?: string | null;
  actorId?: string | null;
  actorName?: string | null;
  actorUsername?: string | null;
  cancelledById?: string | null;
  cancelledByName?: string | null;
  cancelledByUsername?: string | null;
};

const KIND_VENTE: Record<VenteKind, string> = {
  plat: "plat",
  local: "plat local",
  boisson: "boisson",
  extra: "extraordinaire",
};

function toEvent(doc: HistoriqueDoc): HistoriqueEvent {
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
  };
}

function venteToEvent(doc: VenteLogDoc): HistoriqueEvent {
  const kindLabel = KIND_VENTE[doc.kind] ?? doc.kind;
  const zone = doc.site === "zogbo" ? "Zogbo" : "Gbégamey";
  const detail = `${Math.abs(doc.qty)} × ${kindLabel} · ${zone}`;

  if (doc.cancelledAt) {
    return {
      id: `vente-annul-${doc._id.toHexString()}`,
      at: doc.cancelledAt,
      date: doc.date,
      kind: "vente_annulee",
      site: doc.site,
      title: `Vente annulée · ${doc.name}`,
      detail,
      actorId: doc.cancelledById ?? doc.actorId ?? null,
      actorName: doc.cancelledByName ?? doc.actorName ?? null,
      actorUsername: doc.cancelledByUsername ?? doc.actorUsername ?? null,
      amount: -doc.amount,
    };
  }

  return {
    id: `vente-${doc._id.toHexString()}`,
    at: doc.at,
    date: doc.date,
    kind: "vente",
    site: doc.site,
    title: `${doc.qty > 0 ? "Vente" : "Correction"} · ${doc.name}`,
    detail,
    actorId: doc.actorId ?? null,
    actorName: doc.actorName ?? null,
    actorUsername: doc.actorUsername ?? null,
    amount: doc.amount,
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
  };
  const db = await getDb();
  await db.collection<HistoriqueDoc>("historique").insertOne(doc);
  return toEvent(doc);
}

export async function listHistorique(input: {
  from?: string;
  to?: string;
  kind?: HistoriqueKind | "all";
  site?: VenteSite | "all";
  actorId?: string;
  q?: string;
  limit?: number;
}): Promise<{ events: HistoriqueEvent[]; total: number }> {
  const limit = Math.min(Math.max(input.limit ?? 200, 1), 500);
  const kind = input.kind ?? "all";
  const site = input.site ?? "all";
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
  if (kind !== "all" && kind !== "vente") {
    histFilter.kind = kind;
  }
  if (site !== "all") {
    histFilter.site = site;
  }
  if (actorId) {
    histFilter.actorId = actorId;
  }

  const venteFilter: Record<string, unknown> = {};
  if (from || to) {
    if (from && to) {
      venteFilter.date = { $gte: from, $lte: to };
    } else if (from) {
      venteFilter.date = { $gte: from };
    } else if (to) {
      venteFilter.date = { $lte: to };
    }
  }
  if (site !== "all") {
    venteFilter.site = site;
  }
  if (actorId) {
    venteFilter.$or = [
      { actorId },
      { cancelledById: actorId },
    ];
  }

  const includeVentes =
    kind === "all" || kind === "vente" || kind === "vente_annulee";
  const includeHist = kind !== "vente";

  const [histDocs, venteDocs] = await Promise.all([
    includeHist
      ? db
          .collection<HistoriqueDoc>("historique")
          .find(histFilter)
          .sort({ at: -1 })
          .limit(limit)
          .toArray()
      : Promise.resolve([] as HistoriqueDoc[]),
    includeVentes
      ? db
          .collection<VenteLogDoc>("ventes_log")
          .find(venteFilter)
          .sort({ at: -1 })
          .limit(limit)
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
        e.actorName ?? "",
        e.actorUsername ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }

  events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const sliced = events.slice(0, limit);

  return { events: sliced, total: sliced.length };
}
