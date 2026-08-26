/**
 * Rapport quotidien — agrège CA, équipes, top produits, pertes, écarts caisse,
 * stock critique. Texte prêt à copier (WhatsApp / e-mail) ; pas d'API d'envoi inventée.
 */
import { SITE_LABELS, type UserSite } from "@/lib/auth-types";
import { ecartCaisse } from "@/lib/caisse-model";
import { listCaisses } from "@/lib/caisse-repo";
import { formatFcfa } from "@/lib/format";
import { listPertes, sumPertesCost } from "@/lib/pertes-repo";
import { getQuantitesVendues } from "@/lib/quantites-vendues-repo";
import { getEpuises, getStockPayload } from "@/lib/stock-repo";
import type { CaisseKey, VenteSite } from "@/lib/types";
import { sumCaByShift, sumCaForSite } from "@/lib/vente-repo";
import { todayIsoDate } from "@/lib/zogbo-calc";

export type RapportQuotidienSiteBlock = {
  site: VenteSite;
  label: string;
  ca: number;
  ventesCount: number;
  articlesQty: number;
  panierMoyen: number;
  caJour: number;
  caNuit: number;
  caHorsEquipe: number;
  topProduits: Array<{ name: string; qty: number; amount: number }>;
  pertesMontant: number;
  pertesCount: number;
  ecartCaisse: number | null;
  caisseStatut: string;
  stockCritique: Array<{ name: string; stockLeft: number | null; kind: string }>;
};

export type RapportQuotidien = {
  date: string;
  generatedAt: string;
  sites: RapportQuotidienSiteBlock[];
  totaux: {
    ca: number;
    ventesCount: number;
    articlesQty: number;
    panierMoyen: number;
    pertesMontant: number;
    ecartsCaisse: number;
  };
  texteBrut: string;
};

async function blockForSite(
  date: string,
  site: VenteSite,
): Promise<RapportQuotidienSiteBlock> {
  const [ca, shifts, qte, pertesAgg, pertes, caisses, epuises, stock] =
    await Promise.all([
      sumCaForSite(date, site),
      sumCaByShift(date, site),
      getQuantitesVendues({
        from: date,
        to: date,
        site,
        kind: "all",
        q: "",
      }),
      sumPertesCost({ from: date, to: date, site }),
      listPertes({ date, site, limit: 200 }),
      listCaisses({ caisse: site as CaisseKey, limit: 8 }),
      getEpuises({ date, scopeSite: site }),
      getStockPayload({
        date,
        scopeSite: site,
        onlyActive: false,
        families: ["plats", "accompagnements", "boissons"],
      }),
    ]);

  const session =
    caisses.find((s) => s.date === date) ?? caisses[0] ?? null;
  const ecart = session ? ecartCaisse(session) : null;

  const topProduits = qte.rows.slice(0, 5).map((r) => ({
    name: r.name,
    qty: r.qty,
    amount: r.amount,
  }));

  const critiqueMap = new Map<
    string,
    { name: string; stockLeft: number | null; kind: string }
  >();
  for (const e of epuises.slice(0, 20)) {
    critiqueMap.set(`${e.kind}:${e.productId}`, {
      name: e.name,
      stockLeft: e.restant,
      kind: e.kind,
    });
  }
  for (const row of stock.rows) {
    if (!row.belowThreshold) continue;
    critiqueMap.set(`${row.kind}:${row.productId}`, {
      name: row.name,
      stockLeft: row.stockVendable ?? row.stockFinal ?? null,
      kind: row.kind,
    });
  }

  const ventesCount = qte.totals.lignes;
  const articlesQty = qte.totals.qty;
  const panierMoyen = ventesCount > 0 ? Math.round(ca / ventesCount) : 0;

  return {
    site,
    label: SITE_LABELS[site],
    ca,
    ventesCount,
    articlesQty,
    panierMoyen,
    caJour: shifts.jour,
    caNuit: shifts.nuit,
    caHorsEquipe: shifts.aucune,
    topProduits,
    pertesMontant: pertesAgg.total,
    pertesCount: pertes.filter((p) => !p.cancelledAt).length,
    ecartCaisse: ecart,
    caisseStatut: session
      ? session.statut === "fermee"
        ? "Clôturée"
        : session.statut === "en_comptage"
          ? "En comptage"
          : "Ouverte"
      : "Aucune session",
    stockCritique: [...critiqueMap.values()].slice(0, 12),
  };
}

function buildTexte(rapport: Omit<RapportQuotidien, "texteBrut">): string {
  const lines: string[] = [
    `King Fish — Rapport du ${rapport.date}`,
    `Généré le ${new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "Africa/Porto-Novo",
    }).format(new Date(rapport.generatedAt))}`,
    "",
    `CA total : ${formatFcfa(rapport.totaux.ca)}`,
    `Ventes : ${rapport.totaux.ventesCount} · Articles : ${rapport.totaux.articlesQty}`,
    `Panier moyen : ${formatFcfa(rapport.totaux.panierMoyen)}`,
    `Pertes : ${formatFcfa(rapport.totaux.pertesMontant)}`,
    `Écarts caisse (Σ |écart|) : ${formatFcfa(rapport.totaux.ecartsCaisse)}`,
    "",
  ];

  for (const s of rapport.sites) {
    lines.push(`— ${s.label} —`);
    lines.push(
      `CA ${formatFcfa(s.ca)} · Jour ${formatFcfa(s.caJour)} · Nuit ${formatFcfa(s.caNuit)}`,
    );
    lines.push(
      `Ventes ${s.ventesCount} · Panier moy. ${formatFcfa(s.panierMoyen)}`,
    );
    lines.push(
      `Caisse : ${s.caisseStatut}${
        s.ecartCaisse === null ? "" : ` · écart ${formatFcfa(s.ecartCaisse)}`
      }`,
    );
    lines.push(`Pertes : ${s.pertesCount} · ${formatFcfa(s.pertesMontant)}`);
    if (s.topProduits.length) {
      lines.push(
        `Top : ${s.topProduits.map((p) => `${p.name} (${p.qty})`).join(", ")}`,
      );
    }
    if (s.stockCritique.length) {
      lines.push(
        `Stock critique : ${s.stockCritique.map((p) => p.name).join(", ")}`,
      );
    }
    lines.push("");
  }

  lines.push(
    "Envoi : copiez ce texte vers WhatsApp ou e-mail. Branchez une API d'envoi plus tard si besoin.",
  );
  return lines.join("\n");
}

export async function buildRapportQuotidien(input: {
  date?: string;
  userSite: UserSite;
  siteFilter?: VenteSite | "all";
}): Promise<RapportQuotidien> {
  const date =
    input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date)
      ? input.date
      : todayIsoDate();

  const sites: VenteSite[] =
    input.userSite === "zogbo" || input.userSite === "gbegamey"
      ? [input.userSite]
      : input.siteFilter === "zogbo" || input.siteFilter === "gbegamey"
        ? [input.siteFilter]
        : ["zogbo", "gbegamey"];

  const blocks = await Promise.all(sites.map((s) => blockForSite(date, s)));

  const totaux = {
    ca: blocks.reduce((s, b) => s + b.ca, 0),
    ventesCount: blocks.reduce((s, b) => s + b.ventesCount, 0),
    articlesQty: blocks.reduce((s, b) => s + b.articlesQty, 0),
    panierMoyen: 0,
    pertesMontant: blocks.reduce((s, b) => s + b.pertesMontant, 0),
    ecartsCaisse: blocks.reduce(
      (s, b) => s + (b.ecartCaisse === null ? 0 : Math.abs(b.ecartCaisse)),
      0,
    ),
  };
  totaux.panierMoyen =
    totaux.ventesCount > 0 ? Math.round(totaux.ca / totaux.ventesCount) : 0;

  const base = {
    date,
    generatedAt: new Date().toISOString(),
    sites: blocks,
    totaux,
  };

  return { ...base, texteBrut: buildTexte(base) };
}
