import { getDb } from "@/lib/mongodb";
import { isExecutiveAdminAccount } from "@/lib/auth-types";
import type { SessionUser } from "@/lib/auth-types";
import type { ModulesComptables, ParametresComptables } from "@/lib/types";

const DOC_ID = "config";

type ParametresComptablesDoc = Omit<ParametresComptables, "modules"> & {
  _id: string;
  modules?: Partial<ModulesComptables>;
};

const DEFAUT: ParametresComptables = {
  modules: { capital: false, amortissements: false, comptesTiers: false },
  capital: 0,
  creancesClients: 0,
  dettesFournisseurs: 0,
  updatedAt: null,
  updatedByName: null,
};

/**
 * Seul le compte direction (marc) active ces modules : chacun engage un
 * changement de méthode comptable (capitalisation, amortissement, créances à
 * crédit) qui dépasse la correction opérationnelle du quotidien.
 */
export function peutActiverModulesComptables(user: SessionUser): boolean {
  return isExecutiveAdminAccount(user.username);
}

function toParametres(doc: ParametresComptablesDoc | null): ParametresComptables {
  if (!doc) return DEFAUT;
  return {
    modules: {
      capital: doc.modules?.capital === true,
      amortissements: doc.modules?.amortissements === true,
      comptesTiers: doc.modules?.comptesTiers === true,
    },
    capital: Math.max(0, Math.round(Number(doc.capital) || 0)),
    creancesClients: Math.max(0, Math.round(Number(doc.creancesClients) || 0)),
    dettesFournisseurs: Math.max(
      0,
      Math.round(Number(doc.dettesFournisseurs) || 0),
    ),
    updatedAt: doc.updatedAt ?? null,
    updatedByName: doc.updatedByName ?? null,
  };
}

export async function getParametresComptables(): Promise<ParametresComptables> {
  const db = await getDb();
  const doc = await db
    .collection<ParametresComptablesDoc>("parametres_comptables")
    .findOne({ _id: DOC_ID });
  return toParametres(doc);
}

export async function saveParametresComptables(input: {
  modules?: Partial<ModulesComptables>;
  capital?: number;
  creancesClients?: number;
  dettesFournisseurs?: number;
  user: SessionUser;
}): Promise<ParametresComptables> {
  if (!peutActiverModulesComptables(input.user)) {
    throw new Error(
      "Seul le compte direction peut activer ou modifier les modules comptables avancés.",
    );
  }
  const db = await getDb();
  const existing = await getParametresComptables();

  const next: ParametresComptables = {
    modules: {
      capital: input.modules?.capital ?? existing.modules.capital,
      amortissements:
        input.modules?.amortissements ?? existing.modules.amortissements,
      comptesTiers: input.modules?.comptesTiers ?? existing.modules.comptesTiers,
    },
    capital:
      input.capital !== undefined
        ? Math.max(0, Math.round(Number(input.capital) || 0))
        : existing.capital,
    creancesClients:
      input.creancesClients !== undefined
        ? Math.max(0, Math.round(Number(input.creancesClients) || 0))
        : existing.creancesClients,
    dettesFournisseurs:
      input.dettesFournisseurs !== undefined
        ? Math.max(0, Math.round(Number(input.dettesFournisseurs) || 0))
        : existing.dettesFournisseurs,
    updatedAt: new Date().toISOString(),
    updatedByName: input.user.name,
  };

  await db.collection<ParametresComptablesDoc>("parametres_comptables").updateOne(
    { _id: DOC_ID },
    { $set: next },
    { upsert: true },
  );

  return next;
}
