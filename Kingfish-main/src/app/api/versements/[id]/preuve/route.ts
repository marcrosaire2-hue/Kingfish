import { NextResponse } from "next/server";
import { AuthError, authErrorResponse, requireUser } from "@/lib/api-auth";
import { reportError } from "@/lib/report-error";
import {
  getVersementPreuveBytes,
  getVersementPreuveUrl,
} from "@/lib/versements-repo";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** Sert une capture (Cloudinary via redirect, ou octets Mongo). `?i=` = index. */
export async function GET(request: Request, context: RouteContext) {
  try {
    await requireUser();
    const { id } = await context.params;
    const rawIndex = new URL(request.url).searchParams.get("i");
    const index = Math.max(0, Number.parseInt(rawIndex || "0", 10) || 0);

    const remote = await getVersementPreuveUrl(id, index);
    if (remote) {
      return NextResponse.redirect(remote, 302);
    }

    const local = await getVersementPreuveBytes(id, index);
    if (!local) {
      return NextResponse.json({ error: "Preuve introuvable." }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(local.bytes), {
      status: 200,
      headers: {
        "Content-Type": local.mime,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    if (error instanceof AuthError) return authErrorResponse(error);
    reportError("GET /api/versements/[id]/preuve", error);
    return authErrorResponse(error);
  }
}
