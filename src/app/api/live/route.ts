import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import { readLiveSeq } from "@/lib/live-state";

export const runtime = "nodejs";

/** Numéro de version des données : change dès qu'une écriture a eu lieu. */
export async function GET() {
  try {
    await requireUser();
    const seq = await readLiveSeq();
    return NextResponse.json(
      { seq },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return authErrorResponse(error);
  }
}
