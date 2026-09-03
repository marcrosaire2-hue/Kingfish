import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import { canManageUsers } from "@/lib/auth-types";
import {
  assertCronAuthorized,
  gmailConfigured,
  resolveMailAlertRecipients,
} from "@/lib/mail/mail-config";
import { sendWeeklyDigest, sendMonthlyDigest } from "@/lib/mail/digests";
import { sendMail } from "@/lib/mail/gmail-send";
import { reportError } from "@/lib/report-error";

export const runtime = "nodejs";

/**
 * Cron / test digests.
 * - Cron : Authorization: Bearer $MAIL_CRON_SECRET
 * - Admin connecté : peut forcer un envoi de test
 *
 * Query : ?kind=week|month|test
 */
export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const kind = (searchParams.get("kind") || "week").toLowerCase();

    const cronOk = assertCronAuthorized(request);
    if (!cronOk) {
      const user = await requireUser();
      if (!canManageUsers(user)) {
        return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
      }
    }

    if (!gmailConfigured()) {
      return NextResponse.json(
        {
          error:
            "Gmail non configuré (GMAIL_CLIENT_ID, SECRET, REFRESH_TOKEN, USER).",
        },
        { status: 503 },
      );
    }

    const recipients = await resolveMailAlertRecipients();
    if (recipients.length === 0) {
      return NextResponse.json(
        {
          error:
            "Aucun destinataire (liste Alertes mail ou MAIL_ALERT_TO).",
        },
        { status: 400 },
      );
    }

    if (kind === "test") {
      const ok = await sendMail({
        to: recipients,
        subject: "King Fish — test e-mail",
        text: "Ceci est un message de test depuis King Fish Manager.",
        html: "<p>Ceci est un message de test depuis <strong>King Fish Manager</strong>.</p>",
      });
      return NextResponse.json({ ok, kind: "test", to: recipients });
    }

    if (kind === "month") {
      const result = await sendMonthlyDigest();
      return NextResponse.json({ kind: "month", ...result });
    }

    const result = await sendWeeklyDigest();
    return NextResponse.json({ kind: "week", ...result });
  } catch (error) {
    reportError("POST /api/mail/cron", error);
    return authErrorResponse(error);
  }
}

export async function GET(request: Request) {
  return POST(request);
}
