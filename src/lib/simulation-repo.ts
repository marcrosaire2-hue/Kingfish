import { getMongoClient, getRealDbName } from "@/lib/mongodb";
import {
  SIM_COLLECTIONS_EXCLUES,
  simulationDbName,
} from "@/lib/simulation-shared";

const LOT = 500;

/**
 * Repart d'un bac à sable neuf pour l'utilisateur : supprime son éventuelle
 * base de simulation, puis y copie le catalogue, les réglages, les stocks et
 * les comptes de la vraie base (hors opérations réelles : tickets, caisses,
 * versements…). La vraie base n'est jamais modifiée — uniquement lue.
 */
export async function reinitialiserSimulation(
  username: string,
): Promise<{ db: string; collections: number; documents: number }> {
  const client = await getMongoClient();
  const reelle = getRealDbName();
  const nom = simulationDbName(reelle, username);
  if (nom === reelle) throw new Error("Base de simulation invalide.");

  const source = client.db(reelle);
  const bac = client.db(nom);
  await bac.dropDatabase();

  const noms = (await source.listCollections({}, { nameOnly: true }).toArray())
    .map((info) => info.name)
    .filter((n) => !n.startsWith("system.") && !SIM_COLLECTIONS_EXCLUES.has(n));

  // Collections copiées en parallèle : la latence réseau domine, pas le volume.
  const copies = await Promise.all(
    noms.map(async (name) => {
      const docs = await source.collection(name).find({}).toArray();
      for (let i = 0; i < docs.length; i += LOT) {
        await bac
          .collection(name)
          .insertMany(docs.slice(i, i + LOT) as never[], { ordered: false });
      }
      return docs.length;
    }),
  );
  const collections = noms.length;
  const documents = copies.reduce((a, b) => a + b, 0);
  return { db: nom, collections, documents };
}

/** Supprime le bac à sable de l'utilisateur (fin de formation). */
export async function supprimerSimulation(username: string): Promise<void> {
  const client = await getMongoClient();
  const reelle = getRealDbName();
  const nom = simulationDbName(reelle, username);
  if (nom === reelle) return;
  await client.db(nom).dropDatabase();
}
