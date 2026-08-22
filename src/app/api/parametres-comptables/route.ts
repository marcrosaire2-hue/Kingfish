import { NextResponse } from "next/server";
import { authErrorResponse, requireAdmin } from "@/lib/api-auth";
import {
  getParametresComptables,
  peutActiverModulesComptables,
  saveParametresComptables,
} from "@/lib/parametres-comptables-repo";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireAdmin();
    const parametres = await getParametresComptables();
    return NextResponse.json({
      ...parametres,
      peutActiver: peutActiverModulesComptables(user),
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAdmin();
    const body = (await request.json()) as {
      modules?: {
        capital?: boolean;
        amortissements?: boolean;
        comptesTiers?: boolean;
      };
      capital?: number;
      creancesClients?: number;
      dettesFournisseurs?: number;
    };
    const parametres = await saveParametresComptables({
      modules: body.modules,
      capital: body.capital,
      creancesClients: body.creancesClients,
      dettesFournisseurs: body.dettesFournisseurs,
      user,
    });
    return NextResponse.json({
      ...parametres,
      peutActiver: peutActiverModulesComptables(user),
    });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return authErrorResponse(error);
  }
}
