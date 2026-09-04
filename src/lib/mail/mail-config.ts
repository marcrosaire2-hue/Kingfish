/**
 * Configuration envoi Gmail (OAuth2).
 *
 * Variables d’environnement :
 * - GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN / GMAIL_USER
 * - MAIL_ALERT_TO — destinataires de secours (virgules), fusionnés avec la liste admin
 * - MAIL_SALE_NOTIFY=0 — couper les mails à chaque ticket POS (activés par défaut si Gmail OK)
 * - MAIL_DIGEST_NOTIFY=0 — couper les points jour / mois / hebdo (activés par défaut si Gmail OK)
 * - MAIL_CRON_SECRET — Bearer pour /api/mail/cron (?kind=day|month|week|test)

 * - APP_PUBLIC_URL (ou NEXT_PUBLIC_APP_URL / RENDER_EXTERNAL_URL) — lien « Ouvrir » dans les mails
 */

import { getMailAlertEmails } from "@/lib/mail/mail-recipients-repo";

export function gmailConfigured(): boolean {
  return Boolean(
    process.env.GMAIL_CLIENT_ID?.trim() &&
      process.env.GMAIL_CLIENT_SECRET?.trim() &&
      process.env.GMAIL_REFRESH_TOKEN?.trim() &&
      process.env.GMAIL_USER?.trim(),
  );
}

/** Destinataires depuis l’env seulement (secours / bootstrap). */
export function mailAlertRecipientsFromEnv(): string[] {
  const raw = process.env.MAIL_ALERT_TO ?? "";
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
}

/**
 * Destinataires effectifs : liste gérée par Marc en base + MAIL_ALERT_TO.
 */
export async function resolveMailAlertRecipients(): Promise<string[]> {
  const [fromDb, fromEnv] = await Promise.all([
    getMailAlertEmails().catch(() => [] as string[]),
    Promise.resolve(mailAlertRecipientsFromEnv()),
  ]);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const email of [...fromDb, ...fromEnv]) {
    if (seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

/** @deprecated préférer resolveMailAlertRecipients */
export function mailAlertRecipients(): string[] {
  return mailAlertRecipientsFromEnv();
}

/**
 * Mail à chaque ticket POS.
 * Activé dès que Gmail est configuré ; mettre MAIL_SALE_NOTIFY=0 pour couper.
 */
export function saleNotifyEnabled(): boolean {
  return process.env.MAIL_SALE_NOTIFY !== "0" && gmailConfigured();
}

export function digestNotifyEnabled(): boolean {
  return process.env.MAIL_DIGEST_NOTIFY !== "0" && gmailConfigured();
}

export function mailCronSecret(): string | null {
  const s = process.env.MAIL_CRON_SECRET?.trim();
  return s || null;
}

export function assertCronAuthorized(request: Request): boolean {
  const secret = mailCronSecret();
  if (!secret) return false;
  const auth = request.headers.get("authorization") ?? "";
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer && bearer === secret) return true;
  const header = request.headers.get("x-mail-cron-secret")?.trim();
  return Boolean(header && header === secret);
}
