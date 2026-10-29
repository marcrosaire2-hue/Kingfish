import { after } from "next/server";
import {
  resolveMailAlertRecipients,
  saleNotifyEnabled,
} from "@/lib/mail/mail-config";
import { sendBrevoMail } from "@/lib/mail/brevo-send";
import { setBrevoStatus } from "@/lib/mail/mail-status-repo";
import { sendMail, MailRateLimitError } from "@/lib/mail/gmail-send";
import { saleTicketMail } from "@/lib/mail/mail-templates";
import { listValidTicketsForDate } from "@/lib/pos-repo";
import { reportError } from "@/lib/report-error";
import type { PosTicket } from "@/lib/types";

async function sendSaleTicketMail(ticket: PosTicket): Promise<void> {
  if (!saleNotifyEnabled()) return;
  const to = await resolveMailAlertRecipients();
  if (to.length === 0) return;
  const mail = saleTicketMail(ticket);
  await sendMail({ to, ...mail });
}

/**
 * Notifie les admins d’une vente POS.
 * Utilise `after()` pour que l’envoi survive à la réponse HTTP (Render / Node).
 * Ne fait jamais échouer la vente.
 */
export function notifySaleTicketAsync(ticket: PosTicket): void {
  if (!saleNotifyEnabled()) return;

  after(async () => {
    try {
      await sendSaleTicketMail(ticket);
    } catch (error) {
      reportError("mail/notifySaleTicket", error);
    }
  });
}

/**
 * Vente direction : prévient l'administrateur par Brevo dès l'encaissement
 * (liste de destinataires des alertes admin). Indépendant de MAIL_SALE_NOTIFY
 * et de Gmail ; ne fait jamais échouer la vente.
 */
export function notifyDirectionSaleAsync(ticket: PosTicket): void {
  if (ticket.venteOrigine !== "direction") return;

  after(async () => {
    try {
      const to = await resolveMailAlertRecipients();
      if (to.length === 0) {
        console.warn("[mail] Vente direction : aucun destinataire admin configuré.");
        await setBrevoStatus({
          ok: false,
          error: `Vente direction ${ticket.numero} : aucun destinataire enregistré.`,
        }).catch(() => undefined);
        return;
      }
      const sent = await sendBrevoMail({ to, ...saleTicketMail(ticket) });
      await setBrevoStatus({
        ok: sent,
        error: sent
          ? null
          : `Vente direction ${ticket.numero} : Brevo non configuré (clé ou expéditeur).`,
      }).catch(() => undefined);
    } catch (error) {
      reportError("mail/notifyDirectionSale", error);
      await setBrevoStatus({
        ok: false,
        error: `Vente direction ${ticket.numero} : ${error instanceof Error ? error.message : "envoi impossible"}`,
      }).catch(() => undefined);
    }
  });
}

/** Envoi synchrone (rejeu / rattrapage admin). */
export async function notifySaleTicketNow(
  ticket: PosTicket,
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  if (!saleNotifyEnabled()) return { ok: false, skipped: true };
  try {
    const to = await resolveMailAlertRecipients();
    if (to.length === 0) return { ok: false, skipped: true };
    const mail = saleTicketMail(ticket);
    const ok = await sendMail({ to, ...mail });
    return { ok };
  } catch (error) {
    if (error instanceof MailRateLimitError) throw error;
    reportError("mail/notifySaleTicketNow", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Envoi impossible",
    };
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Renvoie un mail par ticket POS valide de la journée
 * (espacement + attente si rate-limit Gmail).
 */
export async function resendSaleMailsForDate(date: string): Promise<{
  date: string;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
}> {
  const tickets = await listValidTicketsForDate(date);
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (let i = 0; i < tickets.length; i += 1) {
    try {
      const result = await notifySaleTicketNow(tickets[i]!);
      if (result.skipped) skipped += 1;
      else if (result.ok) sent += 1;
      else failed += 1;
    } catch (error) {
      if (error instanceof MailRateLimitError) {
        const waitMs = Math.min(
          20 * 60 * 1000,
          Math.max(2000, error.retryAt.getTime() - Date.now() + 2000),
        );
        await sleep(waitMs);
        try {
          const retry = await notifySaleTicketNow(tickets[i]!);
          if (retry.skipped) skipped += 1;
          else if (retry.ok) sent += 1;
          else failed += 1;
        } catch (retryErr) {
          reportError("mail/resendSaleMailsForDate", retryErr);
          failed += 1;
        }
      } else {
        reportError("mail/resendSaleMailsForDate", error);
        failed += 1;
      }
    }
    if (i < tickets.length - 1) await sleep(2500);
  }
  return { date, total: tickets.length, sent, failed, skipped };
}
