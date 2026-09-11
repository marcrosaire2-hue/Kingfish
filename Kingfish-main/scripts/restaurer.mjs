/**
 * Restauration d'une sauvegarde produite par scripts/sauvegarde.mjs.
 *
 * Par défaut le script ne fait que simuler : il faut --yes pour écrire, car la
 * restauration remplace le contenu des collections concernées.
 *
 * Usage :
 *   node --env-file=.env.local scripts/restaurer.mjs sauvegardes/2026-08-12T08-00-00-000Z
 *   node --env-file=.env.local scripts/restaurer.mjs <dossier> --yes
 *   node --env-file=.env.local scripts/restaurer.mjs <dossier> --yes --seulement=ventes_log,parametres
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { MongoClient } from "mongodb";

const args = process.argv.slice(2);
const dossier = args.find((a) => !a.startsWith("--"));
const confirme = args.includes("--yes");
const seulement = args
  .find((a) => a.startsWith("--seulement="))
  ?.slice("--seulement=".length)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!dossier) {
  console.error("Indiquez le dossier de sauvegarde à restaurer.");
  process.exit(1);
}

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI manquant (utilisez --env-file=.env.local).");
  process.exit(1);
}

const fichiers = (await readdir(dossier))
  .filter((f) => f.endsWith(".json") && f !== "_manifeste.json")
  .filter((f) => !seulement || seulement.includes(f.replace(/\.json$/, "")));

if (fichiers.length === 0) {
  console.error("Aucun fichier à restaurer dans ce dossier.");
  process.exit(1);
}

const client = new MongoClient(uri);
await client.connect();
const db = client.db(process.env.MONGODB_DB || "gestion_restaurant");

for (const fichier of fichiers.sort()) {
  const name = fichier.replace(/\.json$/, "");
  const docs = JSON.parse(await readFile(path.join(dossier, fichier), "utf8"));

  if (!confirme) {
    const actuel = await db.collection(name).countDocuments({});
    console.log(
      `${name} : ${actuel} document(s) en base seraient remplacés par ${docs.length} — simulation`,
    );
    continue;
  }

  const col = db.collection(name);
  await col.deleteMany({});
  if (docs.length > 0) {
    // Les dates sont sérialisées en chaînes ISO : on les restaure en Date là
    // où la collection en attend (index TTL, comparaisons).
    const restaures = docs.map((doc) => {
      const copie = { ...doc };
      for (const [cle, valeur] of Object.entries(copie)) {
        if (
          typeof valeur === "string" &&
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(valeur) &&
          /At$|Until$/.test(cle)
        ) {
          copie[cle] = new Date(valeur);
        }
      }
      return copie;
    });
    await col.insertMany(restaures);
  }
  console.log(`${name} : ${docs.length} document(s) restauré(s)`);
}

if (!confirme) {
  console.log("\nSimulation. Ajoutez --yes pour écrire réellement.");
}

await client.close();
