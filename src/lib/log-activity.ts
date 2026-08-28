import type { SessionUser } from "@/lib/auth-types";
import type { HistoriqueAction } from "@/lib/historique-types";
import {
  appendHistorique,
  type HistoriqueActor,
  type HistoriqueKind,
  type HistoriqueSite,
} from "@/lib/historique-repo";

export function actorOf(
  user: SessionUser | null | undefined,
): HistoriqueActor | null {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    username: user.username,
  };
}

type LogMeta = {
  action?: HistoriqueAction | null;
  productName?: string | null;
  qty?: number | null;
  previousQty?: number | null;
  unitPrice?: number | null;
  ticketNumero?: string | null;
};

export async function logActivity(input: {
  user?: SessionUser | null;
  kind: Exclude<HistoriqueKind, "vente">;
  title: string;
  detail: string;
  date?: string | null;
  site?: HistoriqueSite;
  amount?: number | null;
} & LogMeta): Promise<void> {
  try {
    await appendHistorique({
      kind: input.kind,
      title: input.title,
      detail: input.detail,
      date: input.date,
      site: input.site,
      amount: input.amount,
      actor: actorOf(input.user),
      action: input.action,
      productName: input.productName,
      qty: input.qty,
      previousQty: input.previousQty,
      unitPrice: input.unitPrice,
      ticketNumero: input.ticketNumero,
    });
  } catch (error) {
    console.error("historique log failed", error);
  }
}

export async function logCriticalActivity(input: {
  user?: SessionUser | null;
  kind: Exclude<HistoriqueKind, "vente">;
  title: string;
  detail: string;
  date?: string | null;
  site?: HistoriqueSite;
  amount?: number | null;
} & LogMeta): Promise<void> {
  await appendHistorique({
    kind: input.kind,
    title: input.title,
    detail: input.detail,
    date: input.date,
    site: input.site,
    amount: input.amount,
    actor: actorOf(input.user),
    action: input.action,
    productName: input.productName,
    qty: input.qty,
    previousQty: input.previousQty,
    unitPrice: input.unitPrice,
    ticketNumero: input.ticketNumero,
  });
}
