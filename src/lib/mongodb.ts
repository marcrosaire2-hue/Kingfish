import { MongoClient, type Db } from "mongodb";

declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

function getUri(): string {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI manquant dans .env.local");
  }
  return uri;
}

function getDbName(): string {
  return process.env.MONGODB_DB || "gestion_restaurant";
}

function createClient(): Promise<MongoClient> {
  const client = new MongoClient(getUri());
  return client.connect();
}

export async function getDb(): Promise<Db> {
  if (!global._mongoClientPromise) {
    global._mongoClientPromise = createClient();
  }
  const client = await global._mongoClientPromise;
  return client.db(getDbName());
}
