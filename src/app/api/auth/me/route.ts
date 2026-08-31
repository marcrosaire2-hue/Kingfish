import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import { homeForRole } from "@/lib/auth-types";
import { resolveEffectiveNav } from "@/lib/autorisations-repo";
import { clientIpFrom } from "@/lib/login-throttle";
import { touchConnexionSession } from "@/lib/connexions-repo";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const nav = await resolveEffectiveNav(user);
    const ip = clientIpFrom(request);
    await touchConnexionSession({ user, ip }).catch(() => undefined);
    return NextResponse.json({
      user: { ...user, nav },
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
