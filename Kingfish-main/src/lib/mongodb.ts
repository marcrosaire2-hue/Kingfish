import { MongoClient, type Db } from "mongodb";
import { MONGO_INDEXES } from "@/lib/mongo-indexes";
import { reportError } from "@/lib/report-error";

declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
  // eslint-disable-next-line no-var
  var _mongoIndexesPromise: Promise<void> | undefined;
}

function getUri(): string {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI manquant dans .env.local");
  }
  return uri;
}

/**
 * La production Atlas / mongodb+srv active TLS via l'URI.
 * Un hôte `localhost` reste en clair pour le développement.
 * Les identifiants ne doivent jamais être dans le code source.
 */

function getDbName(): string {
  return process.env.MONGODB_DB || "gestion_restaurant";
}

function createClient(): Promise<MongoClient> {
  const client = new MongoClient(getUri());
  return client.connect();
}

/** Client Mongo partagé (transactions éventuelles, index). */
export async function getMongoClient(): Promise<MongoClient> {
  if (!global._mongoClientPromise) {
    global._mongoClientPromise = createClient();
  }
  return global._mongoClientPromise;
}

/**
 * Crée les index manquants une fois par process. Si un index du même nom
 * existe déjà avec d’autres options (ex. filtre partiel ajouté plus tard),
 * on le remplace. Les autres erreurs sont journalisées sans bloquer.
 */
async function ensureMongoIndexes(db: Db): Promise<void> {
  for (const def of MONGO_INDEXES) {
    const col = db.collection(def.collection);
    const options = {
      name: def.name,
      background: true,
      ...(def.unique ? { unique: true } : {}),
      ...(def.partialFilterExpression
        ? { partialFilterExpression: def.partialFilterExpression }
        : {}),
    };
    try {
      await col.createIndex(def.index, options);
    } catch (error) {
      const code =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof (error as { code?: unknown }).code === "number"
          ? (error as { code: number }).code
          : null;
      // 85 = IndexOptionsConflict (même nom, options différentes).
      if (code === 85) {
        try {
          await col.dropIndex(def.name);
          await col.createIndex(def.index, options);
          continue;
        } catch (retryError) {
          reportError(
            `ensureMongoIndexes ${def.collection}.${def.name} (recreate)`,
            retryError,
          );
          continue;
        }
      }
      reportError(`ensureMongoIndexes ${def.collection}.${def.name}`, error);
    }
  }
}

export async function getDb(): Promise<Db> {
  const client = await getMongoClient();
  const db = client.db(getDbName());
  if (!global._mongoIndexesPromise) {
    global._mongoIndexesPromise = ensureMongoIndexes(db).catch((error) => {
      reportError("ensureMongoIndexes", error);
      // Permet un nouvel essai au prochain getDb si le premier a échoué net.
      global._mongoIndexesPromise = undefined;
    });
  }
  return db;
}
