import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/mongodb";
import {
  choisirComptages,
  computeConsommationVente,
  computeProduction,
  consommationNette,
  ficheId,
  isMagasinUnit,
  magasinActif,
  normalizeFiche,
  syntheseManquants,
  type Fiche,
  type FicheProductKind,
  type MagasinArticle,
  type ManquantRow,
  type ManquantSynthese,
  type ProductionCalcul,
  type ProductionSaisie,
  type VenteAjustements,
} from "@/lib/magasin-calc";
import { reportError } from "@/lib/report-error";
import {
  applyStockEvents,
  type StockBalance,
  type StockEvent,
} from "@/lib/stock-ledger";
import {
  appendStockEvents,
  getStockBalance,
  readStockEvents,
  STOCK_EVENTS_COLLECTION,
} from "@/lib/stock-ledger-repo";
import { recordStockEvents } from "@/lib/stock-ledger-write";
import type { VenteKind, VenteSite } from "@/lib/types";
import { shiftIsoDate, todayIsoDate } from "@/lib/zogbo-calc";

const ARTICLES = "magasin_articles";
const FICHES = "fiches_composition";
const PRODUCTIONS = "magasin_productions";
const MANQUANTS = "magasin_manquants";

type ArticleDoc = Omit<MagasinArticle, "id"> & { _id: string };
type FicheDoc = Omit<Fiche, "id"> & { _id: string };

type Acteur = { id: string; name: string } | null | undefined;

export type Production = ProductionCalcul & {
  id: string;
  site: VenteSite;
  date: string;
  at: string;
  ficheId: string;
  productName: string;
  lots: number;
  actorName: string | null;
  cancelledAt: string | null;
};
type ProductionDoc = Omit<Production, "id"> & { _id: string };

type ManquantDoc = ManquantRow & {
  _id: string;
  site: VenteSite;
  date: string;
  at: string;
  source: "vente" | "production";
  /** Vente ou production à l'origine de la déclaration. */
  refId: string;
  productName: string;
  actorName: string | null;
  cancelledAt: string | null;
};

const fromArticle = ({ _id, ...doc }: ArticleDoc): MagasinArticle => ({ id: _id, ...doc });
const fromFiche = ({ _id, ...doc }: FicheDoc): Fiche => ({ id: _id, ...doc });

export async function listArticles(site: VenteSite): Promise<MagasinArticle[]> {
  const db = await getDb();
  const docs = await db
    .collection<ArticleDoc>(ARTICLES)
    .find({ site })
    .sort({ name: 1 })
    .toArray();
  return docs.map(fromArticle);
}

export async function listFiches(site: VenteSite): Promise<Fiche[]> {
  const db = await getDb();
  const docs = await db
    .collection<FicheDoc>(FICHES)
    .find({ site })
    .sort({ productName: 1 })
    .toArray();
  return docs.map(fromFiche);
}

export async function saveArticle(input: {
  site: VenteSite;
  id?: string | null;
  name: unknown;
  unit: unknown;
  unitPrice?: unknown;
  threshold?: unknown;
  active?: unknown;
  supplement?: unknown;
  dose?: unknown;
}): Promise<MagasinArticle> {
  const name = String(input.name ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
  if (!name) throw new Error("Indiquez le nom de l'article.");
  if (!isMagasinUnit(input.unit)) throw new Error("Unité invalide.");
  const unitPrice = Math.max(0, Number(input.unitPrice) || 0);
  const threshold = Math.max(0, Number(input.threshold) || 0);
  const supplement = input.supplement === true;
  const dose = supplement ? Math.max(0, Number(input.dose) || 0) : 0;
  if (supplement && dose <= 0) {
    throw new Error("Indiquez la quantité retirée par plat pour ce supplément.");
  }

  const db = await getDb();
  const col = db.collection<ArticleDoc>(ARTICLES);
  const existants = await col.find({ site: input.site }).toArray();
  const doublon = existants.find(
    (a) => a._id !== input.id && a.name.toLowerCase() === name.toLowerCase(),
  );
  if (doublon) throw new Error("Un article porte déjà ce nom.");

  const id = input.id ? String(input.id) : `mag-${randomUUID().slice(0, 8)}`;
  const actuel = existants.find((a) => a._id === id);
  if (input.id && !actuel) throw new Error("Article introuvable.");
  // Le stock est tenu dans l'unité d'origine : la changer le fausserait.
  if (actuel && actuel.unit !== input.unit) {
    throw new Error("L'unité d'un article existant ne peut pas changer.");
  }
  const doc = {
    site: input.site,
    name,
    unit: input.unit,
    unitPrice,
    threshold,
    active: input.active !== false,
    supplement,
    dose,
  };
  await col.updateOne({ _id: id }, { $set: doc }, { upsert: true });
  return { id, ...doc };
}

export async function saveFiche(input: {
  site: VenteSite;
  productKind: unknown;
  productId: unknown;
  productName: unknown;
  mode: unknown;
  portions?: unknown;
  lines: unknown;
}): Promise<Fiche> {
  const articles = await listArticles(input.site);
  const fiche = normalizeFiche(input, articles);
  const updatedAt = new Date().toISOString();
  const { id, ...doc } = fiche;
  const db = await getDb();
  await db
    .collection<FicheDoc>(FICHES)
    .updateOne({ _id: id }, { $set: { ...doc, updatedAt } }, { upsert: true });
  return { ...fiche, updatedAt };
}

export async function deleteFiche(site: VenteSite, id: string): Promise<void> {
  const db = await getDb();
  const res = await db.collection<FicheDoc>(FICHES).deleteOne({ _id: id, site });
  if (!res.deletedCount) throw new Error("Fiche introuvable.");
}

export type FicheCaisse = {
  key: string;
  mode: Fiche["mode"];
  ingredients: Array<{ articleId: string; name: string }>;
};

export type SupplementCaisse = { articleId: string; name: string };

const estSupplement = (a: MagasinArticle) =>
  a.active && a.supplement === true && (a.dose ?? 0) > 0;

/** Condiments proposés en supplément sur tous les plats. */
export async function supplementsPourCaisse(
  site: VenteSite,
): Promise<SupplementCaisse[]> {
  if (!magasinActif(site)) return [];
  const articles = await listArticles(site);
  return articles
    .filter(estSupplement)
    .map((a) => ({ articleId: a.id, name: a.name }));
}

/** Ce dont la caisse a besoin pour déclarer un manque ou un supplément. */
export async function fichesPourCaisse(site: VenteSite): Promise<FicheCaisse[]> {
  if (!magasinActif(site)) return [];
  const [fiches, articles] = await Promise.all([listFiches(site), listArticles(site)]);
  const noms = new Map(articles.map((a) => [a.id, a.name]));
  const ligne = (articleId: string) => ({
    articleId,
    name: noms.get(articleId) ?? "Ingrédient",
  });
  return fiches.map((f) => ({
    key: `${f.productKind}:${f.productId}`,
    mode: f.mode,
    // En lot, les ingrédients se déclarent à la production.
    ingredients:
      f.mode === "commande"
        ? f.lines.filter((l) => !l.supplement).map((l) => ligne(l.articleId))
        : [],
  }));
}

function evenement(input: {
  key: string;
  site: VenteSite;
  family: "magasin" | "portion";
  productId: string;
  name: string;
  type: StockEvent["type"];
  qty: number;
  unit: StockEvent["unit"];
  at: string;
  date: string;
  source: string;
  actorId?: string | null;
}): StockEvent {
  return {
    id: input.key,
    site: input.site,
    family: input.family,
    productId: input.productId,
    name: input.name,
    type: input.type,
    qty: input.qty,
    unit: input.unit,
    at: input.at,
    date: input.date,
    actorId: input.actorId ?? null,
    source: input.source,
    idempotencyKey: input.key,
  };
}

export async function article(site: VenteSite, id: string): Promise<MagasinArticle> {
  const db = await getDb();
  const doc = await db.collection<ArticleDoc>(ARTICLES).findOne({ _id: id, site });
  if (!doc) throw new Error("Article introuvable.");
  return fromArticle(doc);
}

function quantiteStrictementPositive(value: unknown): number {
  const qty = Number(value);
  if (!Number.isFinite(qty) || qty <= 0) throw new Error("Quantité invalide.");
  return qty;
}

/**
 * Entrée au magasin. `reference` : mouvement d'achat qui l'a provoquée, pour
 * ne jamais compter deux fois le même achat. `unitPrice` devient le dernier
 * prix connu de l'article.
 */
export async function enregistrerEntree(input: {
  site: VenteSite;
  articleId: string;
  qty: unknown;
  reference?: string;
  unitPrice?: number;
  actor: Acteur;
}): Promise<void> {
  const a = await article(input.site, input.articleId);
  if (input.unitPrice && input.unitPrice > 0 && input.unitPrice !== a.unitPrice) {
    const db = await getDb();
    await db
      .collection<ArticleDoc>(ARTICLES)
      .updateOne({ _id: a.id }, { $set: { unitPrice: input.unitPrice } });
  }
  await appendStockEvents([
    evenement({
      key: `magasin-entree:${input.reference ?? randomUUID()}`,
      site: input.site,
      family: "magasin",
      productId: a.id,
      name: a.name,
      type: "entree",
      qty: quantiteStrictementPositive(input.qty),
      unit: a.unit,
      at: new Date().toISOString(),
      date: todayIsoDate(),
      source: "achat-magasin",
      actorId: input.actor?.id,
    }),
  ]);
}

/** Comptage physique : écrit le stock et fige l'écart une seule fois. */
export async function enregistrerComptage(input: {
  site: VenteSite;
  family: unknown;
  itemId: string;
  qty: unknown;
  actor: Acteur;
}): Promise<void> {
  const qty = Number(input.qty);
  if (!Number.isFinite(qty) || qty < 0) throw new Error("Quantité invalide.");
  let name: string;
  let unit: StockEvent["unit"];
  let family: "magasin" | "portion";
  if (input.family === "portion") {
    const db = await getDb();
    const fiche = await db
      .collection<FicheDoc>(FICHES)
      .findOne({ _id: input.itemId, site: input.site });
    if (!fiche) throw new Error("Fiche introuvable.");
    name = fiche.productName;
    unit = "portion";
    family = "portion";
  } else {
    const a = await article(input.site, input.itemId);
    name = a.name;
    unit = a.unit;
    family = "magasin";
  }
  await appendStockEvents([
    evenement({
      key: `magasin-comptage:${randomUUID()}`,
      site: input.site,
      family,
      productId: input.itemId,
      name,
      type: "comptage",
      qty,
      unit,
      at: new Date().toISOString(),
      date: todayIsoDate(),
      source: "inventaire",
      actorId: input.actor?.id,
    }),
  ]);
}

async function stockActuel(
  site: VenteSite,
  family: "magasin" | "portion",
  productId: string,
): Promise<number> {
  const balance = await getStockBalance({ site, family, productId });
  return balance?.stock ?? 0;
}

export async function declarerProduction(input: {
  site: VenteSite;
  ficheId: string;
  lots: unknown;
  portions?: unknown;
  saisies?: ProductionSaisie[];
  actor: Acteur;
}): Promise<Production> {
  const db = await getDb();
  const doc = await db
    .collection<FicheDoc>(FICHES)
    .findOne({ _id: input.ficheId, site: input.site });
  if (!doc) throw new Error("Fiche introuvable.");
  const fiche = fromFiche(doc);
  const lots = Number(input.lots);
  const portionsSaisies =
    input.portions === null || input.portions === undefined || input.portions === ""
      ? null
      : Number(input.portions);
  const calcul = computeProduction({
    fiche,
    lots,
    portions: portionsSaisies,
    saisies: input.saisies,
  });

  const articles = new Map((await listArticles(input.site)).map((a) => [a.id, a]));
  const id = `prod-${randomUUID().slice(0, 12)}`;
  const at = new Date().toISOString();
  const date = todayIsoDate();
  const prefix = `prod:${id}`;
  const actorName = input.actor?.name ?? null;

  const events: StockEvent[] = calcul.lignes
    .filter((l) => l.reel > 0)
    .map((l) =>
      evenement({
        key: `${prefix}:art:${l.articleId}`,
        site: input.site,
        family: "magasin",
        productId: l.articleId,
        name: articles.get(l.articleId)?.name ?? "Ingrédient",
        type: "consommation",
        qty: l.reel,
        unit: articles.get(l.articleId)?.unit ?? "u",
        at,
        date,
        source: "production",
        actorId: input.actor?.id,
      }),
    );
  if (calcul.portions > 0) {
    events.push(
      evenement({
        key: `${prefix}:portion`,
        site: input.site,
        family: "portion",
        productId: fiche.id,
        name: fiche.productName,
        type: "production",
        qty: calcul.portions,
        unit: "portion",
        at,
        date,
        source: "production",
        actorId: input.actor?.id,
      }),
    );
  }

  const production: Production = {
    ...calcul,
    id,
    site: input.site,
    date,
    at,
    ficheId: fiche.id,
    productName: fiche.productName,
    lots,
    actorName,
    cancelledAt: null,
  };
  const { id: _omit, ...productionDoc } = production;
  void _omit;
  await db
    .collection<ProductionDoc>(PRODUCTIONS)
    .insertOne({ _id: id, ...productionDoc });
  try {
    await appendStockEvents(events);
  } catch (error) {
    // Pas de production à moitié enregistrée.
    await db.collection<ProductionDoc>(PRODUCTIONS).deleteOne({ _id: id });
    await db
      .collection(STOCK_EVENTS_COLLECTION)
      .deleteMany({ site: input.site, idempotencyKey: { $regex: `^${prefix}:` } });
    throw error;
  }

  const manquants = calcul.lignes.filter((l) => l.manquant);
  if (manquants.length) {
    const rows: ManquantDoc[] = await Promise.all(
      manquants.map(async (l) => ({
        _id: `${id}:${l.articleId}`,
        site: input.site,
        date,
        at,
        source: "production" as const,
        refId: id,
        productName: fiche.productName,
        family: "magasin" as const,
        itemId: l.articleId,
        name: articles.get(l.articleId)?.name ?? "Ingrédient",
        qty: l.prevu,
        stockAuMoment: await stockActuel(input.site, "magasin", l.articleId),
        actorName,
        cancelledAt: null,
      })),
    );
    await db.collection<ManquantDoc>(MANQUANTS).insertMany(rows);
  }
  return production;
}

/** Annule une production déclarée à tort : le stock revient à l'identique. */
export async function annulerProduction(input: {
  site: VenteSite;
  id: string;
  actor: Acteur;
}): Promise<void> {
  const db = await getDb();
  const at = new Date().toISOString();
  const doc = await db.collection<ProductionDoc>(PRODUCTIONS).findOneAndUpdate(
    { _id: input.id, site: input.site, cancelledAt: null },
    { $set: { cancelledAt: at } },
  );
  if (!doc) throw new Error("Production introuvable ou déjà annulée.");

  const articles = new Map((await listArticles(input.site)).map((a) => [a.id, a]));
  const prefix = `prod:${doc._id}:annul`;
  const events: StockEvent[] = doc.lignes
    .filter((l) => l.reel > 0)
    .map((l) =>
      evenement({
        key: `${prefix}:art:${l.articleId}`,
        site: input.site,
        family: "magasin",
        productId: l.articleId,
        name: articles.get(l.articleId)?.name ?? "Ingrédient",
        type: "annulation",
        qty: l.reel,
        unit: articles.get(l.articleId)?.unit ?? "u",
        at,
        date: doc.date,
        source: "annulation-production",
        actorId: input.actor?.id,
      }),
    );
  if (doc.portions > 0) {
    events.push(
      evenement({
        key: `${prefix}:portion`,
        site: input.site,
        family: "portion",
        productId: doc.ficheId,
        name: doc.productName,
        type: "retrait_entree",
        qty: doc.portions,
        unit: "portion",
        at,
        date: doc.date,
        source: "annulation-production",
        actorId: input.actor?.id,
      }),
    );
  }
  await appendStockEvents(events);
  await db
    .collection<ManquantDoc>(MANQUANTS)
    .updateMany({ site: input.site, refId: doc._id }, { $set: { cancelledAt: at } });
}

function aFiche(kind: VenteKind): kind is FicheProductKind {
  return kind === "plat" || kind === "local";
}

const venteKey = (venteId: string) => `conso:${venteId}:`;

/**
 * Sorties de stock d'une vente. Le journal garde la composition du moment :
 * modifier la fiche plus tard ne réécrit pas le passé. N'échoue jamais : une
 * panne du magasin ne doit pas empêcher un encaissement.
 */
export async function enregistrerConsommationVente(input: {
  venteId: string;
  site: VenteSite;
  date: string;
  at: string;
  kind: VenteKind;
  productId: string;
  qty: number;
  ajustements?: VenteAjustements | null;
  actor?: Acteur;
}): Promise<void> {
  if (!magasinActif(input.site) || !aFiche(input.kind)) return;
  try {
    const db = await getDb();
    const doc = await db
      .collection<FicheDoc>(FICHES)
      .findOne({ _id: ficheId(input.site, input.kind, input.productId) });
    // Un plat sans fiche peut quand même recevoir un supplément.
    if (!doc && !input.ajustements?.supplements?.length) return;
    const fiche = doc ? fromFiche(doc) : null;
    const liste = await listArticles(input.site);
    const { lignes, manquants } = computeConsommationVente({
      fiche,
      qty: input.qty,
      ajustements: input.ajustements,
      supplementsCatalogue: liste
        .filter(estSupplement)
        .map((a) => ({ id: a.id, dose: a.dose ?? 0 })),
    });
    if (!lignes.length && !manquants.length) return;

    const articles = new Map(liste.map((a) => [a.id, a]));
    const nomPlat = fiche?.productName ?? "Plat";
    const nom = (family: string, itemId: string) =>
      family === "portion" ? nomPlat : (articles.get(itemId)?.name ?? "Ingrédient");
    const prefix = venteKey(input.venteId);
    // Une correction négative rend au stock ce qu'une vente aurait retiré.
    const sortie = input.qty > 0;

    await recordStockEvents(
      lignes.map((l) =>
        evenement({
          key: `${prefix}${l.family}:${l.itemId}:init`,
          site: input.site,
          family: l.family,
          productId: l.itemId,
          name: nom(l.family, l.itemId),
          type: !sortie ? "annulation" : l.family === "portion" ? "vente" : "consommation",
          qty: l.qty,
          unit: l.family === "portion" ? "portion" : (articles.get(l.itemId)?.unit ?? "u"),
          at: input.at,
          date: input.date,
          source: "vente",
          actorId: input.actor?.id,
        }),
      ),
      "Magasin · consommation vente",
    );

    if (manquants.length && sortie) {
      const rows: ManquantDoc[] = await Promise.all(
        manquants.map(async (m) => ({
          _id: `${input.venteId}:${m.family}:${m.itemId}`,
          site: input.site,
          date: input.date,
          at: input.at,
          source: "vente" as const,
          refId: input.venteId,
          productName: nomPlat,
          family: m.family,
          itemId: m.itemId,
          name: nom(m.family, m.itemId),
          qty: m.qty,
          stockAuMoment: await stockActuel(input.site, m.family, m.itemId),
          actorName: input.actor?.name ?? null,
          cancelledAt: null,
        })),
      );
      await db.collection<ManquantDoc>(MANQUANTS).insertMany(rows, { ordered: false });
    }
  } catch (error) {
    reportError("Magasin · consommation vente", error, {
      venteId: input.venteId,
      site: input.site,
    });
  }
}

/**
 * Ramène la consommation d'une vente à `facteur` fois ce qu'elle était :
 * 0 pour une annulation, nouvelle quantité / ancienne pour une correction.
 */
async function reequilibrerVente(input: {
  venteId: string;
  site: VenteSite;
  date: string;
  facteur: number;
}): Promise<void> {
  const db = await getDb();
  const prefix = venteKey(input.venteId);
  const docs = await db
    .collection<StockEvent>(STOCK_EVENTS_COLLECTION)
    .find({ site: input.site, idempotencyKey: { $regex: `^${prefix}` } })
    .sort({ at: 1 })
    .toArray();
  if (!docs.length) return;

  const at = new Date().toISOString();
  const nets = consommationNette(docs);
  const events: StockEvent[] = [];
  for (const row of nets.values()) {
    const cible = Math.round(row.net * input.facteur * 10000) / 10000;
    const delta = Math.round((cible - row.net) * 10000) / 10000;
    if (delta === 0) continue;
    const ref = docs.find(
      (d) => d.family === row.family && d.productId === row.productId,
    )!;
    const family = row.family as "magasin" | "portion";
    // Une annulation est unique par vente ; chaque correction est distincte.
    const suffixe = input.facteur === 0 ? "annul" : `ajust:${randomUUID()}`;
    events.push(
      evenement({
        key: `${prefix}${family}:${row.productId}:${suffixe}`,
        site: input.site,
        family,
        productId: row.productId,
        name: ref.name,
        type: delta < 0 ? "annulation" : family === "portion" ? "vente" : "consommation",
        qty: Math.abs(delta),
        unit: ref.unit,
        at,
        date: input.date,
        source: "correction-vente",
      }),
    );
  }
  await recordStockEvents(events, "Magasin · correction vente");
}

/** Vente annulée ou supprimée : remet au stock exactement ce qu'elle a retiré. */
export async function annulerConsommationVente(input: {
  venteId: string;
  site: VenteSite;
  date: string;
}): Promise<void> {
  if (!magasinActif(input.site)) return;
  try {
    await reequilibrerVente({ ...input, facteur: 0 });
    const db = await getDb();
    await db.collection<ManquantDoc>(MANQUANTS).updateMany(
      { site: input.site, refId: input.venteId, cancelledAt: null },
      { $set: { cancelledAt: new Date().toISOString() } },
    );
  } catch (error) {
    reportError("Magasin · annulation vente", error, {
      venteId: input.venteId,
      site: input.site,
    });
  }
}

/** Quantité corrigée : conserve les manques et suppléments, en proportion. */
export async function ajusterConsommationVente(input: {
  venteId: string;
  site: VenteSite;
  date: string;
  ancienneQty: number;
  nouvelleQty: number;
}): Promise<void> {
  if (!magasinActif(input.site) || !input.ancienneQty) return;
  try {
    await reequilibrerVente({
      venteId: input.venteId,
      site: input.site,
      date: input.date,
      facteur: input.nouvelleQty / input.ancienneQty,
    });
  } catch (error) {
    reportError("Magasin · correction vente", error, {
      venteId: input.venteId,
      site: input.site,
    });
  }
}

/** Plats préparés à l'avance et leurs portions, par identifiant de plat. */
export async function preparationsPlats(
  site: VenteSite,
): Promise<Map<string, { stock: number; production: number }>> {
  const out = new Map<string, { stock: number; production: number }>();
  if (!magasinActif(site)) return out;
  const [fiches, events] = await Promise.all([
    listFiches(site),
    readStockEvents({ site, family: "portion" }),
  ]);
  const soldes = applyStockEvents(events);
  for (const fiche of fiches) {
    if (fiche.mode !== "lot" || fiche.productKind !== "plat") continue;
    const solde = soldes.get(`${site}:portion:${fiche.id}`);
    out.set(fiche.productId, {
      stock: solde?.stock ?? 0,
      production: solde?.production ?? 0,
    });
  }
  return out;
}

/** Portions restantes d'un plat ; `null` s'il n'est pas préparé à l'avance. */
export async function preparationPlat(
  site: VenteSite,
  productId: string,
): Promise<number | null> {
  const db = await getDb();
  const id = ficheId(site, "plat", productId);
  const fiche = await db.collection<FicheDoc>(FICHES).findOne({ _id: id });
  if (!fiche || fiche.mode !== "lot") return null;
  return (await getStockBalance({ site, family: "portion", productId: id }))?.stock ?? 0;
}

export type ConsommationEnregistree = Array<{
  family: "magasin" | "portion";
  productId: string;
  name: string;
  unit: StockEvent["unit"];
  net: number;
}>;

/** Ce qu'une vente a réellement retiré, à relire avant de la déplacer. */
export async function lireConsommationVente(input: {
  venteId: string;
  site: VenteSite;
}): Promise<ConsommationEnregistree | null> {
  if (!magasinActif(input.site)) return null;
  try {
    const db = await getDb();
    const docs = await db
      .collection<StockEvent>(STOCK_EVENTS_COLLECTION)
      .find({ site: input.site, idempotencyKey: { $regex: `^${venteKey(input.venteId)}` } })
      .toArray();
    if (!docs.length) return null;
    return [...consommationNette(docs).values()].map((row) => {
      const ref = docs.find(
        (d) => d.family === row.family && d.productId === row.productId,
      )!;
      return {
        family: row.family as "magasin" | "portion",
        productId: row.productId,
        name: ref.name,
        unit: ref.unit,
        net: row.net,
      };
    });
  } catch (error) {
    reportError("Magasin · lecture consommation", error, { venteId: input.venteId });
    return null;
  }
}

/**
 * Vente déplacée vers une autre date : la consommation d'origine (manques
 * compris) est reposée sur la nouvelle ligne, et les manques la suivent.
 */
export async function transfererConsommationVente(input: {
  consommation: ConsommationEnregistree;
  ancienId: string;
  nouvelId: string;
  site: VenteSite;
  date: string;
  at: string;
  facteur: number;
}): Promise<void> {
  try {
    const prefix = venteKey(input.nouvelId);
    const events: StockEvent[] = [];
    for (const row of input.consommation) {
      const net = Math.round(row.net * input.facteur * 10000) / 10000;
      if (net === 0) continue;
      events.push(
        evenement({
          key: `${prefix}${row.family}:${row.productId}:init`,
          site: input.site,
          family: row.family,
          productId: row.productId,
          name: row.name,
          type: net < 0 ? "annulation" : row.family === "portion" ? "vente" : "consommation",
          qty: Math.abs(net),
          unit: row.unit,
          at: input.at,
          date: input.date,
          source: "correction-vente",
        }),
      );
    }
    await recordStockEvents(events, "Magasin · déplacement vente");
    const db = await getDb();
    await db.collection<ManquantDoc>(MANQUANTS).updateMany(
      { site: input.site, refId: input.ancienId },
      {
        $set: {
          refId: input.nouvelId,
          date: input.date,
          at: input.at,
          cancelledAt: null,
        },
      },
    );
  } catch (error) {
    reportError("Magasin · déplacement vente", error, { venteId: input.nouvelId });
  }
}

export type LigneStockMagasin = {
  id: string;
  family: "magasin" | "portion";
  name: string;
  unit: string;
  unitPrice: number;
  threshold: number;
  supplement?: boolean;
  stock: number;
  alerte: boolean;
  lastCounted: number | null;
  lastCountAt: string | null;
  lastEcart: number | null;
};

export type EtatMagasin = {
  today: string;
  articles: MagasinArticle[];
  stock: LigneStockMagasin[];
  portions: LigneStockMagasin[];
  aCompter: string[];
  fichesLot: Fiche[];
  productions: Production[];
  manquants: ManquantSynthese[];
};

const JOURS_RAPPORT = 7;

export async function etatMagasin(site: VenteSite): Promise<EtatMagasin> {
  const today = todayIsoDate();
  const depuis = shiftIsoDate(today, -(JOURS_RAPPORT - 1)) ?? today;
  const db = await getDb();
  const [articles, fiches, evMagasin, evPortions, productions, manquants] =
    await Promise.all([
      listArticles(site),
      listFiches(site),
      readStockEvents({ site, family: "magasin" }),
      readStockEvents({ site, family: "portion" }),
      db
        .collection<ProductionDoc>(PRODUCTIONS)
        .find({ site })
        .sort({ at: -1 })
        .limit(30)
        .toArray(),
      db
        .collection<ManquantDoc>(MANQUANTS)
        .find({ site, cancelledAt: null, date: { $gte: depuis } })
        .toArray(),
    ]);

  const soldes = (events: StockEvent[]) => {
    const out = new Map<string, StockBalance>();
    for (const balance of applyStockEvents(events).values()) {
      out.set(balance.productId, balance);
    }
    return out;
  };
  const magasin = soldes(evMagasin);
  const portions = soldes(evPortions);
  const fichesLot = fiches.filter((f) => f.mode === "lot");

  const ligne = (
    balance: StockBalance | undefined,
    base: Pick<LigneStockMagasin, "id" | "family" | "name" | "unit" | "unitPrice" | "threshold" | "supplement">,
  ): LigneStockMagasin => {
    const stock = balance?.stock ?? 0;
    return {
      ...base,
      stock,
      alerte: stock < 0 || (base.threshold > 0 && stock <= base.threshold),
      lastCounted: balance?.lastCounted ?? null,
      lastCountAt: balance?.lastCountAt ?? null,
      lastEcart: balance?.lastEcart ?? null,
    };
  };

  return {
    today,
    articles,
    stock: articles
      .filter((a) => a.active)
      .map((a) =>
        ligne(magasin.get(a.id), {
          id: a.id,
          family: "magasin",
          name: a.name,
          unit: a.unit,
          unitPrice: a.unitPrice,
          threshold: a.threshold,
          supplement: a.supplement === true,
        }),
      ),
    portions: fichesLot.map((f) =>
      ligne(portions.get(f.id), {
        id: f.id,
        family: "portion",
        name: f.productName,
        unit: "portion",
        unitPrice: 0,
        threshold: 0,
      }),
    ),
    aCompter: choisirComptages({ articles, balances: magasin, today }),
    fichesLot,
    productions: productions.map(({ _id, ...doc }) => ({ id: _id, ...doc })),
    manquants: syntheseManquants(manquants),
  };
}
