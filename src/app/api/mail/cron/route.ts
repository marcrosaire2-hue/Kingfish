import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import { canManageUsers } from "@/lib/auth-types";
import {
  assertCronAuthorized,
  gmailConfigured,
  resolveMailAlertRecipients,
} from "@/lib/mail/mail-config";
import {
  sendDailyDigest,
  sendWeeklyDigest,
  sendMonthlyDigest,
} from "@/lib/mail/digests";
import { sendMail, MailRateLimitError } from "@/lib/mail/gmail-send";
import { testMail } from "@/lib/mail/mail-templates";
import { resendSaleMailsForDate } from "@/lib/mail/notify-sale";
import { reportError } from "@/lib/report-error";
import { todayIsoDate } from "@/lib/zogbo-calc";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Cron / test digests.
 * - Cron : Authorization: Bearer $MAIL_CRON_SECRET
 * - Admin connecté : peut forcer un envoi de test
 *
 * Query :
 *   ?kind=day|week|month|test|sales
 *   &date=YYYY-MM-DD   (optionnel, kind=day|sales)
 *   &ym=YYYY-MM        (optionnel, kind=month)
 *
 * Planification conseillée (Render Cron / cron externe, fuseau Afrique/Porto-Novo) :
 *   - Quotidien ~00:15 → GET/POST .../api/mail/cron?kind=day   (résume la veille)
 *   - 1er du mois ~00:30 → .../api/mail/cron?kind=month        (résume le mois précédent)
 *   - (optionnel) lundi → ?kind=week
 *   - Rattrapage tickets POS du jour → ?kind=sales&date=YYYY-MM-DD
 */
export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const kind = (searchParams.get("kind") || "day").toLowerCase();
    const date = searchParams.get("date")?.trim() || undefined;
    const ym = searchParams.get("ym")?.trim() || undefined;

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
      const mail = testMail();
      const ok = await sendMail({ to: recipients, ...mail });
      return NextResponse.json({ ok, kind: "test", to: recipients });
    }

    if (kind === "sales") {
      const target =
        date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayIsoDate();
      const result = await resendSaleMailsForDate(target);
      return NextResponse.json({ kind: "sales", recipients, ...result });
    }

    if (kind === "day") {
      const result = await sendDailyDigest(undefined, { date });
      if (!result.ok) {
        return NextResponse.json(
          { kind: "day", recipients, ...result },
          { status: 502 },
        );
      }
      return NextResponse.json({
        kind: "day",
        recipients,
        ...result,
      });
    }

    if (kind === "month") {
      const result = await sendMonthlyDigest(undefined, { ym });
      if (!result.ok) {
        return NextResponse.json(
          { kind: "month", recipients, ...result },
          { status: 502 },
        );
      }
      return NextResponse.json({
        kind: "month",
        recipients,
        ...result,
      });
    }

    if (kind === "week") {
      const result = await sendWeeklyDigest();
      if (!result.ok) {
        return NextResponse.json(
          { kind: "week", recipients, ...result },
          { status: 502 },
        );
      }
      return NextResponse.json({
        kind: "week",
        recipients,
        ...result,
      });
    }

    return NextResponse.json(
      { error: "kind invalide (day|week|month|test|sales)." },
      { status: 400 },
    );
  } catch (error) {
    if (error instanceof MailRateLimitError) {
      return NextResponse.json(
        {
          error: `Gmail rate-limit — réessayez vers ${error.retryAt.toLocaleString("fr-FR", { timeZone: "Africa/Porto-Novo" })}.`,
          retryAt: error.retryAt.toISOString(),
        },
        { status: 429 },
      );
    }
    reportError("POST /api/mail/cron", error);
    if (error instanceof Error && error.message && !/Erreur serveur/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    return authErrorResponse(error);
  }
}

export async function GET(request: Request) {
  return POST(request);
}
