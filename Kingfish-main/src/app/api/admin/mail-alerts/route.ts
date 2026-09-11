import { NextResponse } from "next/server";
import { authErrorResponse, requireUserManagementAdmin } from "@/lib/api-auth";
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

export async function GET() {
  try {
    const admin = await requireUserManagementAdmin();
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
    const admin = await requireUserManagementAdmin();
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
