import { readFileSync } from "node:fs";
import path from "node:path";
import {
  APP_LOGO,
  APP_NAME,
  APP_SHORT,
  APP_SITES_LABEL,
  APP_TAGLINE,
} from "@/lib/brand";
import { SITE_LABELS } from "@/lib/auth-types";
import { formatFcfa } from "@/lib/format";
import type { PosTicket } from "@/lib/types";

/** CID de l’image logo embarquée dans le MIME (voir gmail-send). */
export const MAIL_LOGO_CID = "kingfish-logo";

const NAVY = "#0a3d66";
const GOLD = "#e8b923";
const INK = "#142033";
const MUTED = "#5c6b7c";
const LINE = "#d7e0ea";
const PAPER = "#f3f6fa";
const SURFACE = "#ffffff";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** URL publique de l’app (lien « Ouvrir ») — optionnelle. */
export function appPublicUrl(): string | null {
  const raw =
    process.env.APP_PUBLIC_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.RENDER_EXTERNAL_URL?.trim() ||
    "";
  if (!raw) return null;
  return raw.replace(/\/$/, "");
}

export function loadBrandLogoBytes(): {
  contentType: string;
  filename: string;
  data: Buffer;
  cid: string;
} | null {
  try {
    const filename = APP_LOGO.replace(/^\//, "");
    const file = path.join(process.cwd(), "public", filename);
    return {
      contentType: "image/jpeg",
      filename,
      data: readFileSync(file),
      cid: MAIL_LOGO_CID,
    };
  } catch {
    return null;
  }
}

function ctaButton(href: string, label: string): string {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:20px;">
    <tr>
      <td style="border-radius:10px;background:${NAVY};">
        <a href="${esc(href)}"
           style="display:inline-block;padding:12px 20px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;">
          ${esc(label)}
        </a>
      </td>
    </tr>
  </table>`;
}

/**
 * Coquille HTML professionnelle : logo King Fish + bandeau + pied de page.
 */
export function mailShell(title: string, bodyHtml: string, opts?: {
  preheader?: string;
  ctaHref?: string | null;
  ctaLabel?: string;
}): string {
  const preheader = opts?.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(opts.preheader)}</div>`
    : "";
  const cta =
    opts?.ctaHref && opts.ctaLabel
      ? ctaButton(opts.ctaHref, opts.ctaLabel)
      : "";
  const year = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background:${PAPER};font-family:Arial,Helvetica,sans-serif;color:${INK};-webkit-font-smoothing:antialiased;">
  ${preheader}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${SURFACE};border-radius:16px;border:1px solid ${LINE};overflow:hidden;">
          <!-- En-tête marque -->
          <tr>
            <td style="padding:22px 28px 18px;text-align:center;background:${SURFACE};border-bottom:3px solid ${GOLD};">
              <img src="cid:${MAIL_LOGO_CID}" width="72" height="69" alt="${esc(APP_SHORT)}"
                   style="display:block;margin:0 auto 10px;width:72px;height:auto;border:0;outline:none;" />
              <div style="font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${MUTED};">
                ${esc(APP_NAME)}
              </div>
              <div style="margin-top:4px;font-size:12px;color:${MUTED};">
                ${esc(APP_TAGLINE)} · ${esc(APP_SITES_LABEL)}
              </div>
            </td>
          </tr>
          <!-- Titre -->
          <tr>
            <td style="padding:16px 28px;background:${NAVY};">
              <h1 style="margin:0;font-size:18px;line-height:1.35;font-weight:700;color:#ffffff;font-family:Arial,Helvetica,sans-serif;">
                ${esc(title)}
              </h1>
            </td>
          </tr>
          <!-- Corps -->
          <tr>
            <td style="padding:24px 28px 8px;font-size:14px;line-height:1.5;color:${INK};">
              ${bodyHtml}
              ${cta}
            </td>
          </tr>
          <!-- Pied -->
          <tr>
            <td style="padding:18px 28px 22px;background:${PAPER};border-top:1px solid ${LINE};">
              <div style="font-size:12px;line-height:1.5;color:${MUTED};text-align:center;">
                <strong style="color:${NAVY};">${esc(APP_SHORT)}</strong>
                — ${esc(APP_SITES_LABEL)}<br />
                Message automatique · merci de ne pas répondre<br />
                © ${year} ${esc(APP_NAME)}
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function saleTicketMail(ticket: PosTicket): {
  subject: string;
  text: string;
  html: string;
} {
  const site =
    SITE_LABELS[ticket.site as keyof typeof SITE_LABELS] ?? ticket.site;
  const subject = `[${APP_SHORT}] Vente ${ticket.numero} · ${site} · ${formatFcfa(ticket.montant)}`;

  const linesText = ticket.lines
    .map(
      (l) =>
        `  - ${l.qty} × ${l.name} @ ${formatFcfa(l.unitPrice)} = ${formatFcfa(l.amount)}`,
    )
    .join("\n");

  const text = [
    `${APP_NAME} — Ticket ${ticket.numero}`,
    `Date : ${ticket.date}`,
    `Site : ${site}`,
    `Type : ${ticket.saleType}`,
    `Caissier : ${ticket.userName}`,
    ticket.serveurNom ? `Serveur : ${ticket.serveurNom}` : null,
    ticket.tableLabel ? `Table : ${ticket.tableLabel}` : null,
    ticket.clientNom ? `Client : ${ticket.clientNom}` : null,
    ticket.paymentLabel ? `Paiement : ${ticket.paymentLabel}` : null,
    "",
    "Articles :",
    linesText || "  (aucun)",
    "",
    `Brut : ${formatFcfa(ticket.montantBrut)}`,
    ticket.reduction > 0 ? `Remise : −${formatFcfa(ticket.reduction)}` : null,
    `Net : ${formatFcfa(ticket.montant)}`,
    `Heure : ${ticket.at}`,
  ]
    .filter(Boolean)
    .join("\n");

  const rows = ticket.lines
    .map(
      (l) =>
        `<tr>
          <td style="padding:10px 0;border-bottom:1px solid ${LINE};color:${INK};">${esc(l.name)}</td>
          <td style="padding:10px 10px;border-bottom:1px solid ${LINE};text-align:right;white-space:nowrap;color:${MUTED};">${l.qty}</td>
          <td style="padding:10px 0;border-bottom:1px solid ${LINE};text-align:right;white-space:nowrap;font-weight:700;color:${INK};">${esc(formatFcfa(l.amount))}</td>
        </tr>`,
    )
    .join("");

  const meta = [
    ["Date", ticket.date],
    ["Site", site],
    ["Type", ticket.saleType],
    ["Caissier", ticket.userName],
    ticket.serveurNom ? ["Serveur", ticket.serveurNom] : null,
    ticket.tableLabel ? ["Table", ticket.tableLabel] : null,
    ticket.clientNom ? ["Client", ticket.clientNom] : null,
    ticket.paymentLabel ? ["Paiement", ticket.paymentLabel] : null,
  ].filter(Boolean) as [string, string][];

  const metaHtml = meta
    .map(
      ([k, v]) =>
        `<tr>
          <td style="padding:4px 16px 4px 0;color:${MUTED};font-size:13px;width:110px;">${esc(k)}</td>
          <td style="padding:4px 0;font-weight:700;font-size:13px;color:${INK};">${esc(v)}</td>
        </tr>`,
    )
    .join("");

  const appUrl = appPublicUrl();
  const html = mailShell(
    `Ticket ${ticket.numero}`,
    `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 18px;">${metaHtml}</table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
      <thead>
        <tr>
          <th align="left" style="padding:0 0 8px;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};border-bottom:2px solid ${LINE};font-weight:700;">Article</th>
          <th align="right" style="padding:0 10px 8px;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};border-bottom:2px solid ${LINE};font-weight:700;">Qté</th>
          <th align="right" style="padding:0 0 8px;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};border-bottom:2px solid ${LINE};font-weight:700;">Montant</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="3" style="padding:12px 0;color:${MUTED};">Aucun article</td></tr>`}</tbody>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;">
      <tr>
        <td style="padding:16px 18px;border-radius:12px;background:${PAPER};border:1px solid ${LINE};">
          ${
            ticket.reduction > 0
              ? `<div style="font-size:13px;color:${MUTED};margin-bottom:6px;">Remise −${esc(formatFcfa(ticket.reduction))}</div>`
              : ""
          }
          <div style="font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};font-weight:700;">Net à encaisser</div>
          <div style="font-size:26px;font-weight:800;margin-top:4px;color:${NAVY};">${esc(formatFcfa(ticket.montant))}</div>
          <div style="font-size:12px;color:${MUTED};margin-top:6px;">Brut ${esc(formatFcfa(ticket.montantBrut))}</div>
        </td>
      </tr>
    </table>
  `,
    {
      preheader: `${site} · ${formatFcfa(ticket.montant)} · ${ticket.userName}`,
      ctaHref: appUrl ? `${appUrl}/journal` : null,
      ctaLabel: "Ouvrir le journal des ventes",
    },
  );

  return { subject, text, html };
}

export function digestMail(input: {
  kind: "week" | "month";
  label: string;
  from: string;
  to: string;
  zogbo: number;
  gbegamey: number;
  total: number;
  ticketsApprox?: number;
}): { subject: string; text: string; html: string } {
  const title =
    input.kind === "week"
      ? `Point hebdomadaire · ${input.label}`
      : `Point mensuel · ${input.label}`;
  const subject = `[${APP_SHORT}] ${title} · ${formatFcfa(input.total)}`;

  const text = [
    `${APP_NAME}`,
    title,
    `Période : ${input.from} → ${input.to}`,
    "",
    `Zogbo : ${formatFcfa(input.zogbo)}`,
    `Gbégamey : ${formatFcfa(input.gbegamey)}`,
    `Total CA net : ${formatFcfa(input.total)}`,
  ].join("\n");

  const appUrl = appPublicUrl();
  const html = mailShell(
    title,
    `
    <p style="margin:0 0 18px;font-size:14px;color:${MUTED};">
      Période
      <strong style="color:${INK};">${esc(input.from)}</strong>
      →
      <strong style="color:${INK};">${esc(input.to)}</strong>
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding:14px 16px;border-radius:12px;background:${PAPER};border:1px solid ${LINE};width:50%;vertical-align:top;">
          <div style="font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};font-weight:700;">Zogbo</div>
          <div style="font-size:20px;font-weight:800;margin-top:6px;color:${NAVY};">${esc(formatFcfa(input.zogbo))}</div>
        </td>
        <td style="width:12px;"></td>
        <td style="padding:14px 16px;border-radius:12px;background:${PAPER};border:1px solid ${LINE};width:50%;vertical-align:top;">
          <div style="font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};font-weight:700;">Gbégamey</div>
          <div style="font-size:20px;font-weight:800;margin-top:6px;color:${NAVY};">${esc(formatFcfa(input.gbegamey))}</div>
        </td>
      </tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;">
      <tr>
        <td style="padding:16px 18px;border-radius:12px;background:#fff8e8;border:1px solid #efd7a0;">
          <div style="font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};font-weight:700;">CA net total</div>
          <div style="font-size:28px;font-weight:800;margin-top:6px;color:${NAVY};">${esc(formatFcfa(input.total))}</div>
        </td>
      </tr>
    </table>
  `,
    {
      preheader: `CA net ${formatFcfa(input.total)} · Zogbo & Gbégamey`,
      ctaHref: appUrl ? `${appUrl}/analyse` : null,
      ctaLabel: "Voir l’analyse",
    },
  );

  return { subject, text, html };
}

export function testMail(): { subject: string; text: string; html: string } {
  const subject = `[${APP_SHORT}] Test de messagerie`;
  const text = [
    APP_NAME,
    "Ceci est un message de test.",
    "Si vous lisez ceci, l’envoi Gmail fonctionne.",
    APP_TAGLINE,
  ].join("\n");
  const appUrl = appPublicUrl();
  const html = mailShell(
    "Test de messagerie",
    `
    <p style="margin:0 0 12px;font-size:15px;color:${INK};">
      Bonjour,
    </p>
    <p style="margin:0 0 12px;font-size:14px;color:${MUTED};line-height:1.55;">
      Ceci est un message de test depuis <strong style="color:${INK};">${esc(APP_NAME)}</strong>.
      Si le logo King Fish apparaît en haut et que ce message est bien formaté,
      la configuration e-mail est opérationnelle.
    </p>
  `,
    {
      preheader: "Vérification de l’envoi King Fish Manager",
      ctaHref: appUrl,
      ctaLabel: "Ouvrir King Fish Manager",
    },
  );
  return { subject, text, html };
}
