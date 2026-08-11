/**
 * Importe le catalogue AquaPro dans King Fish Manager :
 * - régénère le mapping
 * - met à jour src/lib/seed-parametres.ts
 * - écrit MongoDB `parametres` + `pos_config`
 *
 * Usage: node --env-file=.env.local scripts/import-aquapro-to-kingfish.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const EXPORT = path.join(ROOT, "data/aquapro-export");

function serializeTsValue(value, indent = 2) {
  const pad = " ".repeat(indent);
  const padIn = " ".repeat(indent + 2);
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const lines = value.map((v) => `${padIn}${serializeTsValue(v, indent + 2)},`);
    return `[\n${lines.join("\n")}\n${pad}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 0) return "{}";
    const lines = keys.map(
      (k) => `${padIn}${k}: ${serializeTsValue(value[k], indent + 2)},`,
    );
    return `{\n${lines.join("\n")}\n${pad}}`;
  }
  return "null";
}

async function main() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || "gestion_restaurant";
  if (!uri) throw new Error("MONGODB_URI manquant (.env.local)");

  // 1) Regenerate mapping from AquaPro dump
  const map = spawnSync(
    process.execPath,
    [path.join(__dirname, "map-aquapro-to-kingfish.mjs")],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (map.status !== 0) {
    console.error(map.stdout, map.stderr);
    throw new Error("map-aquapro-to-kingfish a échoué");
  }
  console.log(map.stdout.trim());

  const draft = JSON.parse(
    await fs.readFile(path.join(EXPORT, "kingfish-parametres-draft.json"), "utf8"),
  );
  const pos = JSON.parse(
    await fs.readFile(path.join(EXPORT, "kingfish-pos-config.json"), "utf8"),
  );

  const parametres = {
    baseDishes: draft.baseDishes,
    combos: draft.combos ?? [],
    drinks: draft.drinks,
    localDishes: draft.localDishes,
    updatedAt: null,
  };

  // 2) Update seed source of truth
  const seedTs = `import type { Parametres } from "./types";

/**
 * Catalogue repris d’AquaPro (aquapro.kbedigital.com).
 * Régénéré par scripts/import-aquapro-to-kingfish.mjs
 * Source dump : data/aquapro-export/
 */
export const SEED_PARAMETRES: Parametres = ${serializeTsValue(parametres, 0)};
`;
  await fs.writeFile(path.join(ROOT, "src/lib/seed-parametres.ts"), seedTs);
  console.log("→ src/lib/seed-parametres.ts");

  // 3) Mongo import
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const now = new Date().toISOString();

  const payload = { ...parametres, updatedAt: now };
  await db.collection("parametres").updateOne(
    { _id: "parametres" },
    { $set: payload },
    { upsert: true },
  );
  console.log("→ Mongo parametres", {
    baseDishes: payload.baseDishes.length,
    localDishes: payload.localDishes.length,
    drinks: payload.drinks.length,
    combos: payload.combos.length,
  });

  const posDoc = {
    _id: "pos_config",
    source: "aquapro",
    categories: pos.categories,
    paymentMethods: pos.paymentMethods,
    tables: pos.tables,
    units: pos.units,
    users: pos.users,
    serveurs: pos.serveurs,
    updatedAt: now,
  };
  await db.collection("pos_config").updateOne(
    { _id: "pos_config" },
    { $set: posDoc },
    { upsert: true },
  );
  console.log("→ Mongo pos_config", {
    categories: pos.categories.length,
    payments: pos.paymentMethods.length,
    tables: pos.tables.length,
    users: pos.users.length,
  });

  // Snapshot meta for audits
  await db.collection("aquapro_import").updateOne(
    { _id: "latest" },
    {
      $set: {
        importedAt: now,
        parametresCounts: {
          baseDishes: payload.baseDishes.length,
          localDishes: payload.localDishes.length,
          drinks: payload.drinks.length,
        },
        draftExtractedAt: draft.extractedAt ?? null,
      },
    },
    { upsert: true },
  );

  await client.close();
  console.log("Import AquaPro → King Fish OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
