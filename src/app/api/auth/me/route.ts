import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import { homeForRole } from "@/lib/auth-types";
import { resolveEffectiveNav } from "@/lib/autorisations-repo";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireUser();
    const nav = await resolveEffectiveNav(user);
    return NextResponse.json({
      user,
      nav,
      home: homeForRole(user.role),
      lockedSite: user.site !== "tous",
      allowedSites:
        user.site === "tous"
          ? (["zogbo", "gbegamey"] as const)
          : ([user.site] as const),
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
