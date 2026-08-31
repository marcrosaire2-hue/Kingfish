import { NextResponse } from "next/server";
import { AuthError, authErrorResponse, requireUser } from "@/lib/api-auth";
import { reportError } from "@/lib/report-error";
import { getVersementPreuveUrl } from "@/lib/versements-repo";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** Redirige vers la capture hébergée sur Cloudinary. */
export async function GET(_request: Request, context: RouteContext) {
  try {
    await requireUser();
    const { id } = await context.params;
    const url = await getVersementPreuveUrl(id);
    if (!url) {
      return NextResponse.json({ error: "Preuve introuvable." }, { status: 404 });
    }
    return NextResponse.redirect(url, 302);
  } catch (error) {
    if (error instanceof AuthError) return authErrorResponse(error);
    reportError("GET /api/versements/[id]/preuve", error);
    return authErrorResponse(error);
  }
}
