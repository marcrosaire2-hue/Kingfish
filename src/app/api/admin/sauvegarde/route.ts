import { authErrorResponse, requireUserManagementAdmin } from "@/lib/api-auth";
import { logCriticalActivity } from "@/lib/log-activity";
import { getDb } from "@/lib/mongodb";
import { consumeRateLimit, rateLimitResponse } from "@/lib/security-rate-limit";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Champs jamais exportés : un fichier téléchargé ne doit pas porter de secrets. */
const STRIPPED_FIELDS: Record<string, string[]> = {
  users: ["passwordHash"],
};

/**
 * Sauvegarde complète de la base, téléchargée par un administrateur
 * (même contenu que `npm run sauvegarde`, hors mots de passe hachés).
 * Écrite en flux, collection par collection, pour ne pas charger toute la
 * base en mémoire. La restauration reste une opération en ligne de commande.
 */
export async function GET() {
  try {
    const admin = await requireUserManagementAdmin();
    const hit = await consumeRateLimit({
      key: `sauvegarde:${admin.id}`,
      limit: 5,
      windowMs: 60 * 60 * 1000,
    });
    if (!hit.allowed) {
      return NextResponse.json(rateLimitResponse(hit.retryAfterSec), {
        status: 429,
        headers: { "Retry-After": String(hit.retryAfterSec) },
      });
    }

    const db = await getDb();
    const names = (await db.listCollections().toArray())
      .map((c) => c.name)
      .sort();
    const enc = new TextEncoder();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");

    await logCriticalActivity({
      user: admin,
      kind: "parametres",
      title: "Sauvegarde téléchargée",
      detail: `${names.length} collection(s) · téléchargée par ${admin.username}`,
    });

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          controller.enqueue(
            enc.encode(
              `{"date":${JSON.stringify(new Date().toISOString())},"base":${JSON.stringify(db.databaseName)},"collections":{`,
            ),
          );
          let firstCollection = true;
          for (const name of names) {
            controller.enqueue(
              enc.encode(`${firstCollection ? "" : ","}${JSON.stringify(name)}:[`),
            );
            firstCollection = false;
            const stripped = STRIPPED_FIELDS[name] ?? [];
            let first = true;
            for await (const doc of db.collection(name).find({})) {
              for (const field of stripped) delete (doc as Record<string, unknown>)[field];
              controller.enqueue(
                enc.encode(`${first ? "" : ","}${JSON.stringify(doc)}`),
              );
              first = false;
            }
            controller.enqueue(enc.encode("]"));
          }
          controller.enqueue(enc.encode("}}"));
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="sauvegarde-${stamp}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
