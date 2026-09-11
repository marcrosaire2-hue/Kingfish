import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import { resolveUserSiteScopeFromUser } from "@/lib/auth-types";
import { getStockPayload } from "@/lib/stock-repo";
import { todayIsoDate } from "@/lib/zogbo-calc";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") || todayIsoDate();
    const scopeSite = resolveUserSiteScopeFromUser(user);

    const payload = await getStockPayload({
      date,
      scopeSite,
      families: ["plats", "accompagnements", "boissons", "matieres"],
    });
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Date invalide")) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return authErrorResponse(error);
  }
}
