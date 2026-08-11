#!/usr/bin/env node
/**
 * Traque / synchronise TOUTES les ventes AquaPro
 * (page fastfood/ToutesLesVentes → api/vente/toutes-les-ventes)
 * puis les importe dans ventes_log + aquapro_tickets.
 *
 * Usage:
 *   node --env-file=.env.local scripts/sync-aquapro-toutes-ventes.mjs
 *   IMPORT=0 node --env-file=.env.local scripts/sync-aquapro-toutes-ventes.mjs  # extract only
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "data/aquapro-export");
const API = process.env.AQUAPRO_API || "https://aquaproapi.kbedigital.com/";
const EMAIL = process.env.AQUAPRO_EMAIL;
const PASSWORD = process.env.AQUAPRO_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error(
    "AQUAPRO_EMAIL et AQUAPRO_PASSWORD requis (ex. .env.local, jamais en dur).",
  );
  process.exit(1);
}
const LIMIT = Number(process.env.AQUAPRO_LIMIT || 50);
const DO_IMPORT = process.env.IMPORT !== "0";

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
  };
}

/** @param {ReturnType<typeof cookieJar>} jar */
async function api(jar, method, p, body) {
  const url = new URL(p.replace(/^\//, ""), API).toString();
  /** @type {Record<string, string>} */
  const headers = {
    Accept: "application/json, text/plain, */*",
    Origin: "https://aquapro.kbedigital.com",
    Referer: "https://aquapro.kbedigital.com/fastfood/ToutesLesVentes",
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
    /* keep */
  }
  return { status: res.status, ok: res.ok, data, url };
}

function runImport() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--env-file=.env.local", "scripts/import-aquapro-ventes.mjs"],
      { cwd: ROOT, stdio: "inherit" },
    );
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`import exit ${code}`)),
    );
  });
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const jar = cookieJar();

  console.log("Login AquaPro…", EMAIL);
  const login = await api(jar, "POST", "api/auth/login", {
    email: EMAIL,
    password: PASSWORD,
  });
  if (!login.ok) {
    console.error("Login failed", login.status, login.data);
    process.exit(1);
  }
  console.log("OK user", login.data?.nom || login.data?.email || login.data?.id);

  const allVentes = [];
  let totalvente = 0;
  let totalreductions = 0;
  let totalPages = 1;
  let totalCount = null;
  const seenIds = new Set();
  let duplicates = 0;

  for (let page = 1; page <= 500; page++) {
    const r = await api(
      jar,
      "GET",
      `api/vente/toutes-les-ventes?page=${page}&limit=${LIMIT}`,
    );
    if (!r.ok) {
      console.error("Page fail", page, r.status, r.data);
      break;
    }
    const chunk = Array.isArray(r.data?.ventes) ? r.data.ventes : [];
    totalvente = r.data?.totalvente ?? totalvente;
    totalreductions = r.data?.totalreductions ?? totalreductions;
    totalPages = Number(r.data?.totalPages) || totalPages;
    totalCount =
      r.data?.total ??
      r.data?.totalCount ??
      r.data?.count ??
      totalCount;

    for (const v of chunk) {
      const id = v?.id ?? v?._id ?? `${v?.numero}-${v?.date}`;
      if (seenIds.has(id)) {
        duplicates += 1;
        continue;
      }
      seenIds.add(id);
      allVentes.push(v);
    }

    console.log(
      `page ${page}/${totalPages} · +${chunk.length} · cumul ${allVentes.length}` +
        (totalCount != null ? ` / ~${totalCount}` : ""),
    );

    if (page >= totalPages || chunk.length === 0) break;
  }

  const dates = allVentes
    .map((v) => v.date || v.createdAt)
    .filter(Boolean)
    .sort();
  const payload = {
    source: "https://aquapro.kbedigital.com/fastfood/ToutesLesVentes",
    api: "api/vente/toutes-les-ventes",
    fetchedAt: new Date().toISOString(),
    totalvente,
    totalreductions,
    totalPages,
    totalCount,
    duplicatesSkipped: duplicates,
    count: allVentes.length,
    dateMin: dates[0] || null,
    dateMax: dates[dates.length - 1] || null,
    ventes: allVentes,
  };

  const file = path.join(OUT, "ventes_toutes.json");
  await fs.writeFile(file, JSON.stringify(payload, null, 2), "utf8");
  console.log("→ ventes_toutes.json", {
    count: allVentes.length,
    totalvente,
    totalreductions,
    dateMin: payload.dateMin,
    dateMax: payload.dateMax,
    duplicates,
  });

  if (DO_IMPORT) {
    console.log("Import King Fish (ventes_log)…");
    await runImport();
  } else {
    console.log("IMPORT=0 → extract seulement");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
