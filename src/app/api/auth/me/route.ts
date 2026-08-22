import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import { homeForRole, navForSession } from "@/lib/auth-types";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({
      user,
      nav: navForSession(user),
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
