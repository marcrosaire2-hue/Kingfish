import { ObjectId } from "mongodb";
import { isValidDate } from "@/lib/day-doc";
import { getDb } from "@/lib/mongodb";
import { getParametres } from "@/lib/parametres-repo";
import type {
  TestPlatEntry,
  TestPlatKind,
  TestPlatLine,
  TestPlatProduct,
} from "@/lib/tests-plats-types";
import type { VenteSite } from "@/lib/types";

type TestPlatDoc = Omit<TestPlatEntry, "id"> & { _id: ObjectId };

const COLLECTION = "tests_plats";
const MAX_LINES = 30;
const MAX_QTY = 1_000;

function toEntry(doc: TestPlatDoc): TestPlatEntry {
  const { _id, ...rest } = doc;
  return { id: _id.toHexString(), ...rest };
}

/** Catalogue testable : mêmes familles que la vente, prix à titre indicatif. */
export async function listTestProducts(): Promise<TestPlatProduct[]> {
  const p = await getParametres();
  return [
    ...p.baseDishes.map((d) => ({
      kind: "plat" as const,
      productId: d.id,
      name: d.name,
      refPrice: d.unitPrice,
      unitCost: d.costPrice ?? 0,
    })),
    ...p.localDishes.map((d) => ({
      kind: "local" as const,
      productId: d.id,
      name: d.name,
      refPrice: d.unitPrice,
      unitCost: d.costPrice ?? 0,
    })),
    ...p.drinks.map((d) => ({
      kind: "boisson" as const,
      productId: d.id,
      name: d.name,
      refPrice: d.salePrice ?? 0,
      unitCost: d.purchasePrice ?? 0,
    })),
  ];
}

export async function recordTestPlat(input: {
  date: string;
  site: VenteSite;
  lines: { kind: TestPlatKind; productId: string; qty: number }[];
  objet?: string;
  observations?: string;
  testeur?: string;
  actor?: { id: string; name: string } | null;
}): Promise<TestPlatEntry> {
  if (!isValidDate(input.date)) throw new Error("Date invalide");
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new Error("Ajoutez au moins un article au test.");
  }
  if (input.lines.length > MAX_LINES) throw new Error("Trop de lignes.");

  const catalogue = await listTestProducts();
  const lines: TestPlatLine[] = input.lines.map((l) => {
    const qty = Number(l.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      throw new Error("Quantité invalide.");
    }
    const p = catalogue.find(
      (c) => c.kind === l.kind && c.productId === l.productId,
    );
    if (!p) throw new Error("Article introuvable au catalogue.");
    return {
      kind: p.kind,
      productId: p.productId,
      name: p.name,
      qty,
      unitCost: p.unitCost,
    };
  });

  const db = await getDb();
  const col = db.collection<TestPlatDoc>(COLLECTION);
  const count = await col.countDocuments({ date: input.date, site: input.site });
  const numero = `TEST-${input.date.replaceAll("-", "").slice(2)}-${String(count + 1).padStart(3, "0")}`;

  const doc: TestPlatDoc = {
    _id: new ObjectId(),
    numero,
    date: input.date,
    site: input.site,
    lines,
    objet: String(input.objet ?? "").trim().slice(0, 120),
    observations: String(input.observations ?? "").trim().slice(0, 600),
    testeur: String(input.testeur ?? "").trim().slice(0, 80),
    cost: lines.reduce((s, l) => s + l.qty * l.unitCost, 0),
    at: new Date().toISOString(),
    actorName: input.actor?.name ?? null,
    cancelledAt: null,
    cancelledByName: null,
  };
  await col.insertOne(doc);
  return toEntry(doc);
}

export async function cancelTestPlat(input: {
  id: string;
  actor?: { id: string; name: string } | null;
  /** Restreint l'annulation au périmètre du compte. */
  site?: VenteSite | "all";
}): Promise<TestPlatEntry> {
  if (!ObjectId.isValid(input.id)) throw new Error("Test introuvable");
  const col = (await getDb()).collection<TestPlatDoc>(COLLECTION);
  const filtre: Record<string, unknown> = {
    _id: new ObjectId(input.id),
    cancelledAt: null,
  };
  if (input.site && input.site !== "all") filtre.site = input.site;
  const cancelledAt = new Date().toISOString();
  const doc = await col.findOneAndUpdate(
    filtre,
    {
      $set: { cancelledAt, cancelledByName: input.actor?.name ?? null },
    },
    { returnDocument: "after" },
  );
  if (!doc) throw new Error("Test introuvable ou déjà annulé");
  return toEntry(doc);
}

export async function listTestsPlats(input: {
  date: string;
  site?: VenteSite | "all";
}): Promise<TestPlatEntry[]> {
  if (!isValidDate(input.date)) throw new Error("Date invalide");
  const filtre: Record<string, unknown> = { date: input.date };
  if (input.site && input.site !== "all") filtre.site = input.site;
  const docs = await (await getDb())
    .collection<TestPlatDoc>(COLLECTION)
    .find(filtre)
    .sort({ at: -1 })
    .limit(200)
    .toArray();
  return docs.map(toEntry);
}
