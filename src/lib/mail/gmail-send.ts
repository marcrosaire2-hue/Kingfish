import { google } from "googleapis";
import { gmailConfigured } from "@/lib/mail/mail-config";
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

function buildMime(input: {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
}): string {
  const boundary = `kf_${Date.now().toString(36)}`;
  const toHeader = input.to.join(", ");
  const subject = encodeSubject(input.subject);
  return [
    `From: King Fish Manager <${input.from}>`,
    `To: ${toHeader}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: quoted-printable",
    "",
    input.text,
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: quoted-printable",
    "",
    input.html,
    "",
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

/** Sujet UTF-8 encodé (RFC 2047). */
function encodeSubject(subject: string): string {
  if (/^[\x20-\x7E]*$/.test(subject)) return subject;
  return `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
}

export type SendMailInput = {
  to: string[];
  subject: string;
  text: string;
  html: string;
};

/**
 * Envoie un e-mail via Gmail API (compte GMAIL_USER + refresh token OAuth).
 * Retourne false si non configuré ou sans destinataire — ne jette pas.
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
    return false;
  }
}
