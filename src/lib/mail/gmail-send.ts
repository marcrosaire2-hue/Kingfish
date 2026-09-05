import { google } from "googleapis";
import { APP_NAME, APP_SHORT } from "@/lib/brand";
import { gmailConfigured } from "@/lib/mail/mail-config";
import { loadBrandLogoBytes } from "@/lib/mail/mail-templates";
import { reportError } from "@/lib/report-error";

function oauthClient() {
  const clientId = process.env.GMAIL_CLIENT_ID!.trim();
  const clientSecret = process.env.GMAIL_CLIENT_SECRET!.trim();
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN!.trim();
  const user = process.env.GMAIL_USER!.trim();
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  return { oauth2, user };
}

/** Encode un message MIME RFC 2822 en base64url pour l’API Gmail. */
function encodeRawMessage(raw: string): string {
  return Buffer.from(raw)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Base64 avec retours à la ligne RFC 2045 (76 colonnes). */
function encodeBase64Wrapped(data: Buffer | string): string {
  const b64 =
    typeof data === "string"
      ? Buffer.from(data, "utf8").toString("base64")
      : data.toString("base64");
  return b64.replace(/(.{76})/g, "$1\r\n").replace(/\r\n$/, "");
}

/** Sujet UTF-8 encodé (RFC 2047). */
function encodeSubject(subject: string): string {
  if (/^[\x20-\x7E]*$/.test(subject)) return subject;
  return `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
}

function encodeFromDisplay(name: string, email: string): string {
  if (/^[\x20-\x7E]*$/.test(name)) return `${name} <${email}>`;
  return `=?UTF-8?B?${Buffer.from(name, "utf8").toString("base64")}?= <${email}>`;
}

function buildMime(input: {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
}): string {
  const toHeader = input.to.join(", ");
  const subject = encodeSubject(input.subject);
  const from = encodeFromDisplay(APP_NAME, input.from);
  const logo = loadBrandLogoBytes();

  const altBoundary = `kf_alt_${Date.now().toString(36)}`;
  const relBoundary = `kf_rel_${Date.now().toString(36)}`;

  const alternative = [
    `--${altBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    encodeBase64Wrapped(input.text),
    "",
    `--${altBoundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    encodeBase64Wrapped(input.html),
    "",
    `--${altBoundary}--`,
  ].join("\r\n");

  const relatedParts = [
    `--${relBoundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    "",
    alternative,
  ];

  if (logo) {
    relatedParts.push(
      "",
      `--${relBoundary}`,
      `Content-Type: ${logo.contentType}; name="${logo.filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-ID: <${logo.cid}>`,
      `Content-Disposition: inline; filename="${logo.filename}"`,
      "",
      encodeBase64Wrapped(logo.data),
    );
  }

  relatedParts.push("", `--${relBoundary}--`, "");

  return [
    `From: ${from}`,
    `To: ${toHeader}`,
    `Subject: ${subject}`,
    `X-Mailer: ${APP_SHORT}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/related; type="multipart/alternative"; boundary="${relBoundary}"`,
    "",
    relatedParts.join("\r\n"),
  ].join("\r\n");
}

export type SendMailInput = {
  to: string[];
  subject: string;
  text: string;
  html: string;
};

export class MailRateLimitError extends Error {
  retryAt: Date;
  constructor(retryAt: Date, message: string) {
    super(message);
    this.name = "MailRateLimitError";
    this.retryAt = retryAt;
  }
}

function parseGmailRetryAt(error: unknown): Date | null {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  const match = /Retry after ([0-9T:\-\.Z]+)/i.exec(msg);
  if (!match?.[1]) return null;
  const ms = Date.parse(match[1]);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms);
}

/**
 * Envoie un e-mail via Gmail API (compte GMAIL_USER + refresh token OAuth).
 * Embarque le logo King Fish en pièce jointe inline (CID).
 * Retourne false si non configuré ou sans destinataire.
 * En cas d’échec API : jette (rate-limit → {@link MailRateLimitError}).
 */
export async function sendMail(input: SendMailInput): Promise<boolean> {
  if (!gmailConfigured()) {
    console.warn("[mail] Gmail non configuré — envoi ignoré.");
    return false;
  }
  const to = input.to.filter(Boolean);
  if (to.length === 0) {
    console.warn("[mail] Aucun destinataire — envoi ignoré.");
    return false;
  }

  try {
    const { oauth2, user } = oauthClient();
    const gmail = google.gmail({ version: "v1", auth: oauth2 });
    const raw = encodeRawMessage(
      buildMime({
        from: user,
        to,
        subject: input.subject,
        text: input.text,
        html: input.html,
      }),
    );
    await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw },
    });
    return true;
  } catch (error) {
    reportError("mail/sendMail", error);
    const retryAt = parseGmailRetryAt(error);
    if (retryAt) {
      throw new MailRateLimitError(
        retryAt,
        error instanceof Error ? error.message : "Rate limit Gmail",
      );
    }
    throw error instanceof Error
      ? error
      : new Error("Envoi Gmail impossible.");
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Envoi avec une relance si Gmail rate-limit (rapports / digests).
 * `maxWaitMs` borne l’attente (ex. 45s pour un clic admin).
 */
export async function sendMailWithRetry(
  input: SendMailInput,
  opts?: { maxWaitMs?: number },
): Promise<boolean> {
  const maxWaitMs = opts?.maxWaitMs ?? 45_000;
  try {
    return await sendMail(input);
  } catch (error) {
    if (!(error instanceof MailRateLimitError)) throw error;
    const waitMs = Math.min(
      maxWaitMs,
      Math.max(1500, error.retryAt.getTime() - Date.now() + 1500),
    );
    if (waitMs > maxWaitMs) throw error;
    await sleep(waitMs);
    return sendMail(input);
  }
}
