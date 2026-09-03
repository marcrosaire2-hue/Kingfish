import {
  resolveMailAlertRecipients,
  saleNotifyEnabled,
} from "@/lib/mail/mail-config";
import { sendMail } from "@/lib/mail/gmail-send";
import { saleTicketMail } from "@/lib/mail/mail-templates";
import { reportError } from "@/lib/report-error";
import type { PosTicket } from "@/lib/types";

/**
 * Notifie les admins d’une vente POS (best-effort, n’échoue jamais la vente).
 */
export function notifySaleTicketAsync(ticket: PosTicket): void {
  if (!saleNotifyEnabled()) return;

  void (async () => {
    try {
      const to = await resolveMailAlertRecipients();
      if (to.length === 0) return;
      const mail = saleTicketMail(ticket);
      await sendMail({ to, ...mail });
    } catch (error) {
      reportError("mail/notifySaleTicket", error);
    }
  })();
}
