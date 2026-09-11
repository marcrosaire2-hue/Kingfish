import { MongoClient } from "mongodb";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const client = new MongoClient(env.MONGODB_URI);
await client.connect();
const db = client.db(env.MONGODB_DB || "gestion_restaurant");

const rows = await db
  .collection("ventes_log")
  .find({ date: "2026-08-17", site: "zogbo", cancelledAt: null })
  .toArray();

console.log(`${rows.length} ligne(s)\n`);
for (const r of rows) {
  console.log(JSON.stringify(r, null, 2));
  console.log("---");
}

await client.close();
