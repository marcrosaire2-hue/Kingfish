import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import { getControlePayload } from "@/lib/controle-repo";
import { resolveUserSiteScopeFromUser } from "@/lib/auth-types";
import { todayIsoDate } from "@/lib/zogbo-calc";

export const runtime = "nodejs";

function monthStart(d = todayIsoDate()) {
  return `${d.slice(0, 7)}-01`;
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from") || monthStart();
    const to = searchParams.get("to") || todayIsoDate();
    const date = searchParams.get("date") || from;
    const scopeSite = resolveUserSiteScopeFromUser(user);

    const payload = await getControlePayload({
      date,
      from,
      to,
      scopeSite,
    });

    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Date invalide")) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (
      error instanceof Error &&
      error.message.includes("date de début")
    ) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return authErrorResponse(error);
  }
}
