import { NextResponse } from "next/server";
import {
  AuthError,
  authErrorResponse,
  requireUserManagementAdmin,
} from "@/lib/api-auth";
import { isExecutiveAdminAccount } from "@/lib/auth-types";
import {
  gmailConfigured,
  mailAlertRecipientsFromEnv,
  resolveMailAlertRecipients,
} from "@/lib/mail/mail-config";
import {
  addMailAlertEmail,
  getMailAlertEmails,
  removeMailAlertEmail,
} from "@/lib/mail/mail-recipients-repo";
import { reportError } from "@/lib/report-error";

export const runtime = "nodejs";

async function requireMarcAdmin() {
  const admin = await requireUserManagementAdmin();
  if (!isExecutiveAdminAccount(admin.username)) {
    throw new AuthError(
      "Réservé au compte direction (Marc) pour gérer les destinataires.",
      403,
    );
  }
  return admin;
}

export async function GET() {
  try {
    const admin = await requireMarcAdmin();
    const [emails, envEmails, effective] = await Promise.all([
      getMailAlertEmails(),
      Promise.resolve(mailAlertRecipientsFromEnv()),
      resolveMailAlertRecipients(),
    ]);
    return NextResponse.json({
      emails,
      envEmails,
      effective,
      gmailConfigured: gmailConfigured(),
      managedBy: admin.username,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireMarcAdmin();
    const body = (await request.json()) as {
      action?: "add" | "remove";
      email?: string;
    };
    const email = String(body.email ?? "").trim();
    if (!email) {
      return NextResponse.json({ error: "E-mail requis." }, { status: 400 });
    }

    if (body.action === "remove") {
      const emails = await removeMailAlertEmail({
        email,
        updatedBy: admin.username,
      });
      const effective = await resolveMailAlertRecipients();
      return NextResponse.json({ emails, effective, removed: true });
    }

    const result = await addMailAlertEmail({
      email,
      updatedBy: admin.username,
    });
    const effective = await resolveMailAlertRecipients();
    return NextResponse.json({
      emails: result.emails,
      effective,
      added: result.added,
    });
  } catch (error) {
    reportError("POST /api/admin/mail-alerts", error);
    if (error instanceof Error && error.message.includes("invalide")) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return authErrorResponse(error);
  }
}
