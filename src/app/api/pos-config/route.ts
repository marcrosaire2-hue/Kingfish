import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/api-auth";
import { logActivity } from "@/lib/log-activity";
import { getPosConfig, savePosConfig } from "@/lib/pos-config-repo";
import type {
  PosCompany,
  PosPaymentMethod,
  PosServeur,
  PosTable,
} from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireUser();
    const config = await getPosConfig();
    return NextResponse.json(config);
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireUser();
    if (user.role !== "admin" && user.role !== "gerant") {
      return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
    }
    const body = (await request.json()) as {
      paymentMethods?: PosPaymentMethod[];
      tables?: PosTable[];
      serveurs?: PosServeur[];
      company?: PosCompany | null;
    };
    const saved = await savePosConfig(body);
    await logActivity({
      user,
      kind: "pos",
      title: "Configuration POS enregistrée",
      detail: `paiements ${saved.paymentMethods.length} · tables ${saved.tables.length} · serveurs ${saved.serveurs.length}`,
      site: "tous",
    });
    return NextResponse.json(saved);
  } catch (error) {
    return authErrorResponse(error);
  }
}
