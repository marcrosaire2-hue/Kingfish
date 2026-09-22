import { NextResponse } from "next/server";
import { AuthError, authErrorResponse, requireUser } from "@/lib/api-auth";
import {
  getKwaterPreuveBytes,
  getKwaterPreuveUrl,
} from "@/lib/kwater-repo";
import { reportError } from "@/lib/report-error";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** Sert la capture (Cloudinary via redirect, ou octets Mongo). */
export async function GET(_request: Request, context: RouteContext) {
  try {
    await requireUser();
    const { id } = await context.params;

    const remote = await getKwaterPreuveUrl(id);
    if (remote) {
      return NextResponse.redirect(remote, 302);
    }

    const local = await getKwaterPreuveBytes(id);
    if (!local) {
      return NextResponse.json(
        { error: "Capture introuvable." },
        { status: 404 },
      );
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
    reportError("GET /api/kwater/[id]/preuve", error);
    return authErrorResponse(error);
  }
}
