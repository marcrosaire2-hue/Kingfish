import { APP_LOGO, APP_NAME } from "@/lib/brand";
import { MAIL_LOGO_CID, appPublicUrl } from "@/lib/mail/mail-templates";
import { reportError } from "@/lib/report-error";

/**
 * Envoi via l'API transactionnelle Brevo.
 *
 * Variables d'environnement :
 * - BREVO_API_KEY — clé API Brevo (jamais dans le code source)
 * - BREVO_SENDER_EMAIL — expéditeur déjà validé dans le compte Brevo
 */

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

export type BrevoMailInput = {
  to: string[];
  subject: string;
  text: string;
  html: string;
};

export function brevoConfigured(): boolean {
  return Boolean(
    process.env.BREVO_API_KEY?.trim() && process.env.BREVO_SENDER_EMAIL?.trim(),
  );
}

/**
 * Brevo n'embarque pas d'image inline (CID) : le logo passe par l'URL publique
 * de l'app si elle est connue, sinon il est retiré du mail.
 */
function withoutCidLogo(html: string): string {
  const appUrl = appPublicUrl();
  const cid = `cid:${MAIL_LOGO_CID}`;
  if (appUrl) return html.split(cid).join(`${appUrl}${APP_LOGO}`);
  return html.replace(new RegExp(`<img[^>]*src="${cid}"[^>]*/>`, "g"), "");
}

export function buildBrevoPayload(
  input: BrevoMailInput,
  sender: { name: string; email: string },
) {
  return {
    sender,
    to: input.to.map((email) => ({ email })),
    subject: input.subject,
    htmlContent: withoutCidLogo(input.html),
    textContent: input.text,
  };
}

/**
 * Envoie un e-mail via Brevo. Retourne false si Brevo n'est pas configuré ou
 * sans destinataire ; jette si l'API refuse l'envoi.
 */
export async function sendBrevoMail(input: BrevoMailInput): Promise<boolean> {
  if (!brevoConfigured()) {
    console.warn("[mail] Brevo non configuré (clé ou expéditeur) — envoi ignoré.");
    return false;
  }
  const to = input.to.filter(Boolean);
  if (to.length === 0) {
    console.warn("[mail] Aucun destinataire — envoi ignoré.");
    return false;
  }

  const res = await fetch(BREVO_ENDPOINT, {
    method: "POST",
    headers: {
      "api-key": process.env.BREVO_API_KEY!.trim(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(
      buildBrevoPayload(
        { ...input, to },
        { name: APP_NAME, email: process.env.BREVO_SENDER_EMAIL!.trim() },
      ),
    ),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const error = new Error(`Brevo ${res.status} : ${detail.slice(0, 300)}`);
    reportError("mail/sendBrevoMail", error);
    throw error;
  }
  return true;
}
