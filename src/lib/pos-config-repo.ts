import { getDb } from "@/lib/mongodb";
import type {
  Fournisseur,
  PosCompany,
  PosConfig,
  PosPaymentMethod,
  PosServeur,
  PosTable,
} from "@/lib/types";

const DOC_ID = "pos_config";

type PosConfigDoc = PosConfig & { _id: string };

const DEFAULT_CONFIG: PosConfig = {
  paymentMethods: [{ id: "pay-cash", libelle: "Cash" }],
  tables: [],
  serveurs: [],
  fournisseurs: [],
  company: null,
  updatedAt: null,
};

function normalize(doc: Partial<PosConfigDoc> | null): PosConfig {
  const methods = (doc?.paymentMethods ?? []).map((p) => ({
    id: String(p.id),
    libelle: String(p.libelle || "").trim() || "Paiement",
  }));
  return {
    paymentMethods: methods.length ? methods : DEFAULT_CONFIG.paymentMethods,
    tables: (doc?.tables ?? []).map((t) => ({
      id: String(t.id),
      reference: String(t.reference || "").trim(),
      emplacement: String(t.emplacement || "").trim(),
    })),
    serveurs: (doc?.serveurs ?? []).map((s) => ({
      id: String(s.id),
      nom: String(s.nom || "").trim(),
    })),
    fournisseurs: (doc?.fournisseurs ?? []).map((f) => ({
      id: String(f.id),
      nom: String(f.nom || "").trim(),
      contact: String(f.contact || "").trim() || undefined,
    })),
    company: doc?.company
      ? {
          nom: doc.company.nom ?? null,
          contacts: doc.company.contacts ?? null,
          adresse: doc.company.adresse ?? null,
          activites: doc.company.activites ?? null,
        }
      : null,
    updatedAt: doc?.updatedAt ?? null,
  };
}

export async function getPosConfig(): Promise<PosConfig> {
  const db = await getDb();
  const existing = await db
    .collection<PosConfigDoc>("pos_config")
    .findOne({ _id: DOC_ID });
  if (existing) return normalize(existing);

  const seeded = { ...DEFAULT_CONFIG, updatedAt: new Date().toISOString() };
  await db.collection<PosConfigDoc>("pos_config").updateOne(
    { _id: DOC_ID },
    { $set: { _id: DOC_ID, ...seeded } },
    { upsert: true },
  );
  return seeded;
}

export async function savePosConfig(data: {
  paymentMethods?: PosPaymentMethod[];
  tables?: PosTable[];
  serveurs?: PosServeur[];
  fournisseurs?: Fournisseur[];
  company?: PosCompany | null;
}): Promise<PosConfig> {
  const current = await getPosConfig();
  const updatedAt = new Date().toISOString();
  const next: PosConfig = {
    paymentMethods: data.paymentMethods ?? current.paymentMethods,
    tables: data.tables ?? current.tables,
    serveurs: data.serveurs ?? current.serveurs,
    fournisseurs: data.fournisseurs ?? current.fournisseurs,
    company: data.company !== undefined ? data.company : current.company,
    updatedAt,
  };
  const db = await getDb();
  await db.collection<PosConfigDoc>("pos_config").updateOne(
    { _id: DOC_ID },
    { $set: { _id: DOC_ID, ...next } },
    { upsert: true },
  );
  return next;
}
