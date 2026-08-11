#!/usr/bin/env node
/**
 * Extraction AquaPro → data/aquapro-export/
 * Auth cookie via api/auth/login (withCredentials).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../data/aquapro-export");
const API = process.env.AQUAPRO_API || "https://aquaproapi.kbedigital.com/";
const EMAIL = process.env.AQUAPRO_EMAIL;
const PASSWORD = process.env.AQUAPRO_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error(
    "AQUAPRO_EMAIL et AQUAPRO_PASSWORD requis (ex. .env.local, jamais en dur).",
  );
  process.exit(1);
}

function cookieJar() {
  /** @type {Map<string, string>} */
  const cookies = new Map();
  return {
    store(res) {
      const list =
        typeof res.headers.getSetCookie === "function"
          ? res.headers.getSetCookie()
          : [];
      for (const line of list) {
        const [pair] = line.split(";");
        const eq = pair.indexOf("=");
        if (eq > 0)
          cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    },
    header() {
      return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    size() {
      return cookies.size;
    },
  };
}

/** @param {ReturnType<typeof cookieJar>} jar */
async function api(jar, method, p, body) {
  const url = new URL(p.replace(/^\//, ""), API).toString();
  /** @type {Record<string, string>} */
  const headers = {
    Accept: "application/json, text/plain, */*",
    Origin: "https://aquapro.kbedigital.com",
    Referer: "https://aquapro.kbedigital.com/",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const c = jar.header();
  if (c) headers.Cookie = c;
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  jar.store(res);
  const text = await res.text();
  let data = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { status: res.status, ok: res.ok, data, url };
}

async function writeJson(name, value) {
  const file = path.join(OUT, name);
  await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8");
  console.log("→", name);
  return file;
}

/** Extract Result[] from AquaPro { Status, Result, Pagination } payloads */
function asResult(d) {
  if (Array.isArray(d)) return d;
  if (d && Array.isArray(d.Result)) return d.Result;
  if (d && Array.isArray(d.data)) return d.data;
  if (d && Array.isArray(d.rows)) return d.rows;
  return null;
}

/** Paginate liste?page=N&limit=100 using Pagination.totalPages */
async function fetchPaged(jar, basePath, { limit = 100, maxPages = 50 } = {}) {
  const all = [];
  let meta = null;
  for (let page = 1; page <= maxPages; page++) {
    const sep = basePath.includes("?") ? "&" : "?";
    const r = await api(
      jar,
      "GET",
      `${basePath}${sep}page=${page}&limit=${limit}`,
    );
    if (!r.ok) {
      return { ok: false, status: r.status, data: r.data, items: all, meta };
    }
    const d = r.data;
    meta = d?.Pagination || d;
    const chunk = asResult(d);
    if (!chunk) {
      return { ok: true, status: r.status, data: d, items: null, meta: d };
    }
    all.push(...chunk);
    const totalPages = d?.Pagination?.totalPages || d?.totalPages || null;
    if (chunk.length === 0) break;
    if (totalPages && page >= totalPages) break;
    if (!totalPages && chunk.length < limit) break;
  }
  return { ok: true, status: 200, items: all, meta };
}

const SIMPLE_GETS = [
  "api/categorie/liste",
  "api/categorie/liste2",
  "api/unitemesure/liste",
  "api/uniteconversion/liste",
  "api/uniteconversion/liste2",
  "api/uniteconversion/listeboissons",
  "api/uniteconversion/listeboissons2",
  "api/produit/liste2",
  "api/moyenpaiement/liste",
  "api/table/liste",
  "api/auth/liste",
  "api/auth/listeserveur",
  "api/direction/liste",
  "api/export/export-db",
  "api/config/liste",
  "api/vente/ventes-par-jour",
  "api/vente/ventes-par-mois",
  "api/vente/stats-ventes-mensuelles",
  "api/vente/comparatif-mensuel",
  "api/vente/vente-hebdomadaire",
  "api/auth/liste2",
  "api/produit/produits-seuil-count",
];

const PAGED = [
  "api/produit/liste",
  "api/categorie/liste",
  "api/moyenpaiement/liste",
  "api/table/liste",
  "api/inventaire/liste",
  "api/inventaireboisson/liste",
  "api/appro/liste",
  "api/approboisson/liste",
];

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const jar = cookieJar();

  console.log("Login…");
  const login = await api(jar, "POST", "api/auth/login", {
    email: EMAIL,
    password: PASSWORD,
  });
  await writeJson("_login.json", {
    status: login.status,
    ok: login.ok,
    cookies: jar.size(),
    user: login.data,
  });
  if (!login.ok) {
    console.error("Login failed", login.status);
    process.exit(1);
  }

  const index = { at: new Date().toISOString(), files: [] };

  for (const p of SIMPLE_GETS) {
    const r = await api(jar, "GET", p);
    const name =
      p
        .replace(/^api\//, "")
        .replace(/[/?&=]/g, "_")
        .replace(/_+/g, "_") + ".json";
    if (r.ok) {
      await writeJson(name, r.data);
      index.files.push({ path: p, file: name, status: r.status });
    } else {
      console.log("×", p, r.status);
      index.files.push({ path: p, status: r.status, error: true });
    }
  }

  for (const p of PAGED) {
    const r = await fetchPaged(jar, p, { limit: 100 });
    const slug = p.replace(/^api\//, "").replace(/[/?&=]/g, "_");
    if (!r.ok) {
      console.log("×", p, r.status);
      index.files.push({ path: p, status: r.status, error: true });
      continue;
    }
    if (r.items) {
      await writeJson(`${slug}_all.json`, r.items);
      index.files.push({
        path: p,
        file: `${slug}_all.json`,
        count: r.items.length,
      });
    } else {
      await writeJson(`${slug}.json`, r.data);
      index.files.push({ path: p, file: `${slug}.json` });
    }
  }

  // Pull detail lines for recent inventaires / appro if we have IDs
  async function pullLines(listFile, linePath, outName) {
    try {
      const raw = await fs.readFile(path.join(OUT, listFile), "utf8");
      const list = JSON.parse(raw);
      const items = Array.isArray(list)
        ? list
        : list?.data || list?.rows || list?.liste || [];
      if (!Array.isArray(items) || items.length === 0) return;
      const details = [];
      for (const item of items.slice(0, 100)) {
        const id = item.id ?? item.Id ?? item.inventaire_id ?? item.appro_id;
        if (id == null) continue;
        const r = await api(jar, "GET", `${linePath}${id}`);
        if (r.ok) details.push({ id, data: r.data });
      }
      if (details.length) {
        await writeJson(outName, details);
        index.files.push({ file: outName, count: details.length });
      }
    } catch {
      /* skip */
    }
  }

  // Prefer *liste2 / full Result files written by SIMPLE_GETS
  async function pullLinesFromResult(listFile, linePath, outName) {
    try {
      const raw = await fs.readFile(path.join(OUT, listFile), "utf8");
      const parsed = JSON.parse(raw);
      const items = asResult(parsed) || [];
      if (!items.length) return;
      const details = [];
      for (const item of items) {
        const id = item.id ?? item.Id;
        if (id == null) continue;
        const r = await api(jar, "GET", `${linePath}${id}`);
        if (r.ok) details.push({ id, header: item, data: r.data });
      }
      if (details.length) {
        await writeJson(outName, details);
        index.files.push({ file: outName, count: details.length });
      }
    } catch {
      /* skip */
    }
  }

  await pullLinesFromResult(
    "inventaire_liste.json",
    "api/inventaire/lignes/",
    "inventaire_lignes.json",
  );
  await pullLinesFromResult(
    "inventaireboisson_liste.json",
    "api/inventaireboisson/lignes/",
    "inventaireboisson_lignes.json",
  );
  await pullLinesFromResult("appro_liste.json", "api/appro/lignes/", "appro_lignes.json");
  await pullLinesFromResult(
    "approboisson_liste.json",
    "api/approboisson/lignes/",
    "approboisson_lignes.json",
  );

  // Caisses par utilisateur + toutes les ventes
  const users = asResult(
    (await api(jar, "GET", "api/auth/liste")).data,
  ) || [];
  const caissesByUser = [];
  for (const u of users) {
    const r = await api(jar, "GET", `api/caisse/liste/${u.id}`);
    const list = asResult(r.data) || [];
    if (list.length) caissesByUser.push({ user: { id: u.id, nom: u.nom, role: u.role }, caisses: list });
  }
  await writeJson("caisses_par_utilisateur.json", caissesByUser);

  const allVentes = [];
  let totalvente = 0;
  let totalreductions = 0;
  for (let page = 1; page <= 200; page++) {
    const r = await api(
      jar,
      "GET",
      `api/vente/toutes-les-ventes?page=${page}&limit=50`,
    );
    if (!r.ok) break;
    const chunk = r.data?.ventes || [];
    totalvente = r.data?.totalvente ?? totalvente;
    totalreductions = r.data?.totalreductions ?? totalreductions;
    allVentes.push(...chunk);
    const totalPages = r.data?.totalPages || 1;
    if (page >= totalPages || chunk.length === 0) break;
  }
  await writeJson("ventes_toutes.json", {
    totalvente,
    totalreductions,
    count: allVentes.length,
    ventes: allVentes,
  });
  index.files.push({ file: "ventes_toutes.json", count: allVentes.length });

  await writeJson("_index.json", index);
  console.log("Done.", index.files.length, "entries");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
