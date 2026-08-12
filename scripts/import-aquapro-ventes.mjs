/**
 * Importe les ventes AquaPro (ventes_toutes.json) dans `ventes_log`.
 * Site : gbegamey (point de vente POS).
 * Idempotent : remplace les lignes `source: "aquapro"`.
 *
 * `SINCE` (YYYY-MM-DD) ne garde que les ventes à partir de cette date métier.
 *
 * Usage:
 *   node --env-file=.env.local scripts/import-aquapro-ventes.mjs
 *   SINCE=2026-08-07 node --env-file=.env.local scripts/import-aquapro-ventes.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient, ObjectId } from "mongodb";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const EXPORT = path.join(ROOT, "data/aquapro-export");
const SITE = "gbegamey";

function normKey(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Date métier Bénin (UTC+1) */
function portoDate(iso) {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Porto-Novo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || "gestion_restaurant";
  if (!uri) throw new Error("MONGODB_URI manquant");

  const since = process.env.SINCE || null;
  if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    throw new Error(`SINCE invalide : ${since} (attendu YYYY-MM-DD)`);
  }

  const raw = JSON.parse(
    await fs.readFile(path.join(EXPORT, "ventes_toutes.json"), "utf8"),
  );
  const draft = JSON.parse(
    await fs.readFile(
      path.join(EXPORT, "kingfish-parametres-draft.json"),
      "utf8",
    ),
  );

  /** @type {Map<string, { id: string, name: string, kind: string, unitPrice: number, costPrice: number }>} */
  const catalog = new Map();
  for (const d of draft.baseDishes || []) {
    catalog.set(normKey(d.name), {
      id: d.id,
      name: d.name,
      kind: "plat",
      unitPrice: Number(d.unitPrice) || 0,
      costPrice: 0,
    });
  }
  for (const d of draft.localDishes || []) {
    catalog.set(normKey(d.name), {
      id: d.id,
      name: d.name,
      kind: "local",
      unitPrice: Number(d.unitPrice) || 0,
      costPrice: 0,
    });
  }
  for (const d of draft.drinks || []) {
    catalog.set(normKey(d.name), {
      id: d.id,
      name: d.name,
      kind: "boisson",
      unitPrice: Number(d.salePrice) || 0,
      costPrice: Number(d.purchasePrice) || 0,
    });
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const col = db.collection("ventes_log");
  const ticketsCol = db.collection("aquapro_tickets");

  const delLog = await col.deleteMany({ source: "aquapro" });
  const delTickets = await ticketsCol.deleteMany({});
  console.log("Nettoyage", {
    ventes_log: delLog.deletedCount,
    tickets: delTickets.deletedCount,
  });

  const docs = [];
  const ticketDocs = [];
  let skipped = 0;
  let beforeSince = 0;
  let unmatched = 0;
  const unmatchedNames = new Set();

  for (const v of raw.ventes || []) {
    const statut = String(v.statut || "");
    const cancelled = statut.toLowerCase().startsWith("annul");
    const valide = statut.toLowerCase().startsWith("valid");
    /** Comme AquaPro « Validé » : hors annulées ET hors en cours */
    const caExcluded = !valide;
    const at = v.date || v.createdAt || new Date().toISOString();
    const date = portoDate(at);
    if (since && date < since) {
      beforeSince++;
      continue;
    }
    const ticketId = v.id;

    ticketDocs.push({
      _id: `aqua-${ticketId}`,
      aquaId: ticketId,
      numero: v.numero,
      date,
      at,
      typeVente: v.type_vente,
      statut: v.statut,
      montant: Number(v.montant) || 0,
      reduction: Number(v.reduction) || 0,
      nomclient: v.nomclient || null,
      caissier: v.user?.nom || null,
      serveur: v.serveur?.nom || null,
      paiement: v.mp?.libelle || null,
      table: v.table
        ? `${v.table.reference} · ${v.table.emplacement}`
        : null,
      lignes: (v.lignevente || []).map((l) => ({
        aquaLigneId: l.id,
        produit: (l.produit?.designation || l.designation || "").trim(),
        qty: Number(l.quantite) || 0,
        unitPrice: Number(l.prix_unitaire) || 0,
        amount: Number(l.montligne) || 0,
        unite: l.unite || null,
      })),
      importedAt: new Date().toISOString(),
    });

    for (const l of v.lignevente || []) {
      const designation = (l.produit?.designation || l.designation || "").trim();
      const qty = Number(l.quantite) || 0;
      if (!designation || qty === 0) {
        skipped++;
        continue;
      }
      const hit = catalog.get(normKey(designation));
      if (!hit) {
        unmatched++;
        unmatchedNames.add(designation);
        // fallback extra
        const unitPrice = Number(l.prix_unitaire) || 0;
        const amount = Number(l.montligne) || unitPrice * qty;
        docs.push({
          _id: new ObjectId(),
          date,
          site: SITE,
          kind: "extra",
          productId: `aqua-extra-${l.id}`,
          name: designation,
          qty,
          unitPrice,
          costPrice: 0,
          amount,
          at,
          cancelledAt: cancelled ? v.updatedAt || at : null,
          caExcluded,
          ticketStatut: statut,
          source: "aquapro",
          aquaVenteId: ticketId,
          aquaLigneId: l.id,
          ticketNumero: v.numero,
          typeVente: v.type_vente,
          caissier: v.user?.nom || null,
          serveur: v.serveur?.nom || null,
        });
        continue;
      }

      const unitPrice = Number(l.prix_unitaire) || hit.unitPrice;
      const amount = Number(l.montligne) || unitPrice * qty;
      docs.push({
        _id: new ObjectId(),
        date,
        site: SITE,
        kind: hit.kind,
        productId: hit.id,
        name: hit.name,
        qty,
        unitPrice,
        costPrice: hit.kind === "boisson" ? hit.costPrice : 0,
        amount,
        at,
        cancelledAt: cancelled ? v.updatedAt || at : null,
        caExcluded,
        ticketStatut: statut,
        source: "aquapro",
        aquaVenteId: ticketId,
        aquaLigneId: l.id,
        ticketNumero: v.numero,
        typeVente: v.type_vente,
        caissier: v.user?.nom || null,
        serveur: v.serveur?.nom || null,
      });
    }
  }

  if (docs.length) await col.insertMany(docs);
  if (ticketDocs.length) await ticketsCol.insertMany(ticketDocs);

  const active = docs.filter((d) => !d.cancelledAt && !d.caExcluded);
  const ca = active.reduce((s, d) => s + d.amount, 0);

  await db.collection("aquapro_import").updateOne(
    { _id: "latest" },
    {
      $set: {
        ventesImportedAt: new Date().toISOString(),
        ventes: {
          tickets: ticketDocs.length,
          lignes: docs.length,
          activeLignes: active.length,
          ca,
          site: SITE,
          since,
          beforeSince,
          skipped,
          unmatched,
          unmatchedNames: [...unmatchedNames],
        },
      },
    },
    { upsert: true },
  );

  await client.close();
  console.log(
    JSON.stringify(
      {
        tickets: ticketDocs.length,
        lignes: docs.length,
        active: active.length,
        ca,
        since,
        beforeSince,
        skipped,
        unmatched,
        unmatchedNames: [...unmatchedNames],
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
