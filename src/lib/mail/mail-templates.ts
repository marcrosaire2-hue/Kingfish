import { SITE_LABELS } from "@/lib/auth-types";
import { formatFcfa } from "@/lib/format";
import type { PosTicket } from "@/lib/types";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shell(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#eef2f6;font-family:Manrope,Segoe UI,sans-serif;color:#1a2332;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f6;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:560px;background:#fff;border-radius:14px;border:1px solid #d5dde8;overflow:hidden;">
        <tr>
          <td style="padding:18px 22px;background:#0b3d5c;color:#fff;">
            <div style="font-size:13px;opacity:.85;letter-spacing:.04em;text-transform:uppercase;">King Fish Manager</div>
            <div style="font-size:20px;font-weight:800;margin-top:4px;">${esc(title)}</div>
          </td>
        </tr>
        <tr><td style="padding:20px 22px;">${bodyHtml}</td></tr>
        <tr>
          <td style="padding:14px 22px;background:#f5f8fc;font-size:12px;color:#5b6b7c;border-top:1px solid #d5dde8;">
            Message automatique — ne pas répondre.
          </td>
        </tr>
      </table>
    </td></tr>
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
  const subject = `Vente ${ticket.numero} · ${site} · ${formatFcfa(ticket.montant)}`;

  const linesText = ticket.lines
    .map(
      (l) =>
        `  - ${l.qty} × ${l.name} @ ${formatFcfa(l.unitPrice)} = ${formatFcfa(l.amount)}`,
    )
    .join("\n");

  const text = [
    `Ticket ${ticket.numero}`,
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
          <td style="padding:6px 0;border-bottom:1px solid #eef2f6;">${esc(l.name)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eef2f6;text-align:right;white-space:nowrap;">${l.qty}</td>
          <td style="padding:6px 0;border-bottom:1px solid #eef2f6;text-align:right;white-space:nowrap;">${esc(formatFcfa(l.amount))}</td>
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
        `<tr><td style="padding:3px 12px 3px 0;color:#5b6b7c;font-size:13px;">${esc(k)}</td><td style="padding:3px 0;font-weight:650;font-size:13px;">${esc(v)}</td></tr>`,
    )
    .join("");

  const html = shell(
    `Ticket ${ticket.numero}`,
    `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">${metaHtml}</table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
      <thead>
        <tr>
          <th align="left" style="padding:0 0 8px;font-size:11px;text-transform:uppercase;color:#5b6b7c;border-bottom:1px solid #d5dde8;">Article</th>
          <th align="right" style="padding:0 8px 8px;font-size:11px;text-transform:uppercase;color:#5b6b7c;border-bottom:1px solid #d5dde8;">Qté</th>
          <th align="right" style="padding:0 0 8px;font-size:11px;text-transform:uppercase;color:#5b6b7c;border-bottom:1px solid #d5dde8;">Montant</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="3" style="padding:8px 0;color:#5b6b7c;">Aucun article</td></tr>`}</tbody>
    </table>
    <div style="margin-top:16px;padding-top:14px;border-top:1px solid #d5dde8;">
      ${ticket.reduction > 0 ? `<div style="font-size:13px;color:#5b6b7c;">Remise −${esc(formatFcfa(ticket.reduction))}</div>` : ""}
      <div style="font-size:22px;font-weight:800;margin-top:4px;">${esc(formatFcfa(ticket.montant))}</div>
      <div style="font-size:12px;color:#5b6b7c;margin-top:4px;">Brut ${esc(formatFcfa(ticket.montantBrut))}</div>
    </div>
  `,
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
  const subject = `${title} · ${formatFcfa(input.total)}`;

  const text = [
    title,
    `Période : ${input.from} → ${input.to}`,
    "",
    `Zogbo : ${formatFcfa(input.zogbo)}`,
    `Gbégamey : ${formatFcfa(input.gbegamey)}`,
    `Total CA net : ${formatFcfa(input.total)}`,
  ].join("\n");

  const html = shell(
    title,
    `
    <p style="margin:0 0 14px;font-size:14px;color:#5b6b7c;">
      Période <strong style="color:#1a2332;">${esc(input.from)}</strong>
      → <strong style="color:#1a2332;">${esc(input.to)}</strong>
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding:12px;border-radius:12px;background:#f5f8fc;border:1px solid #d5dde8;width:50%;">
          <div style="font-size:11px;text-transform:uppercase;color:#5b6b7c;font-weight:700;">Zogbo</div>
          <div style="font-size:18px;font-weight:800;margin-top:4px;">${esc(formatFcfa(input.zogbo))}</div>
        </td>
        <td style="width:10px;"></td>
        <td style="padding:12px;border-radius:12px;background:#f5f8fc;border:1px solid #d5dde8;width:50%;">
          <div style="font-size:11px;text-transform:uppercase;color:#5b6b7c;font-weight:700;">Gbégamey</div>
          <div style="font-size:18px;font-weight:800;margin-top:4px;">${esc(formatFcfa(input.gbegamey))}</div>
        </td>
      </tr>
    </table>
    <div style="margin-top:16px;padding:14px;border-radius:12px;background:#fff7e8;border:1px solid #f0d9a8;">
      <div style="font-size:11px;text-transform:uppercase;color:#5b6b7c;font-weight:700;">CA net total</div>
      <div style="font-size:24px;font-weight:800;margin-top:4px;">${esc(formatFcfa(input.total))}</div>
    </div>
  `,
  );

  return { subject, text, html };
}
