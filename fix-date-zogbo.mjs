import { MongoClient } from "mongodb";
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || "gestion_restaurant");

// Vérifier les 14 ventes concernées avant modif
const toMove = await db.collection("ventes_log")
  .find({ date: "2026-08-19", site: "zogbo" })
  .toArray();
console.log("Avant:", toMove.length, "ventes à déplacer");
for (const v of toMove) console.log("  ", v._id.toString(), v.at, v.name, v.amount + "F");

// Déplacer
const res = await db.collection("ventes_log").updateMany(
  { date: "2026-08-19", site: "zogbo" },
  { $set: { date: "2026-08-18" } }
);
console.log("\nMis à jour:", res.modifiedCount, "documents");

// Vérification
const after18 = await db.collection("ventes_log")
  .find({ date: "2026-08-18", site: "zogbo", cancelledAt: null })
  .toArray();
console.log("\nAprès correction — 18 août:", after18.length, "ventes");
let total = 0;
for (const v of after18) { total += v.amount; console.log("  ", v.at, v.name, v.amount + "F"); }
console.log("  TOTAL:", total, "F");

const after19 = await db.collection("ventes_log")
  .find({ date: "2026-08-19", site: "zogbo" })
  .toArray();
console.log("\n19 août restant:", after19.length, "ventes");

await client.close();
