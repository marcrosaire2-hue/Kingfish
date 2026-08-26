/**
 * Index des collections chaudes (mêmes définitions que scripts/creer-index.mjs).
 * Créés de façon idempotente au premier accès Mongo en production.
 */

export type MongoIndexDef = {
  collection: string;
  index: Record<string, 1 | -1>;
  name: string;
  unique?: boolean;
  /** Filtre partiel (ex. clientRef string uniquement). */
  partialFilterExpression?: Record<string, unknown>;
};

export const MONGO_INDEXES: MongoIndexDef[] = [
  {
    collection: "ventes_log",
    index: { date: 1, site: 1, cancelledAt: 1, at: -1 },
    name: "jour_site_actives",
  },
  {
    collection: "ventes_log",
    index: { site: 1, cancelledAt: 1, date: -1, at: -1 },
    name: "site_dernieres",
  },
  {
    collection: "ventes_log",
    index: { date: 1, kind: 1, cancelledAt: 1 },
    name: "jour_type",
  },
  {
    collection: "ventes_log",
    index: { source: 1 },
    name: "source",
  },
  {
    collection: "pos_tickets",
    index: { date: 1, site: 1, at: -1 },
    name: "jour_site",
  },
  {
    collection: "pos_tickets",
    index: { clientRef: 1, site: 1 },
    name: "reference_poste",
    partialFilterExpression: { clientRef: { $type: "string" } },
  },
  {
    collection: "pos_tickets",
    index: { date: 1, numero: 1 },
    name: "numero_unique",
    unique: true,
  },
  {
    collection: "caisses_sessions",
    index: { caisse: 1, statut: 1 },
    name: "caisse_statut",
  },
  {
    collection: "caisses_sessions",
    index: { date: 1, site: 1 },
    name: "jour_site",
  },
  {
    collection: "caisse_mouvements",
    index: { caisseId: 1, at: -1 },
    name: "caisse_journal",
  },
  {
    collection: "caisse_mouvements",
    index: { transfertId: 1 },
    name: "transfert",
  },
];
