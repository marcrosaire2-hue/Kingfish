import type { HistoriqueEvent } from "@/lib/historique-types";

/** Garde les ventes en régularisation et leurs modifications / annulations liées. */
export function filterRegularisationEvents(
  events: HistoriqueEvent[],
): HistoriqueEvent[] {
  const regLogIds = new Set<string>();
  const regTickets = new Set<string>();

  for (const e of events) {
    if (!e.regularisation) continue;
    if (e.venteLogId) regLogIds.add(e.venteLogId);
    if (e.ticketNumero) regTickets.add(e.ticketNumero);
    if (e.id.startsWith("vente-annul-")) {
      regLogIds.add(e.id.slice("vente-annul-".length));
    } else if (e.id.startsWith("vente-")) {
      regLogIds.add(e.id.slice("vente-".length));
    }
  }

  return events.filter((e) => {
    if (e.regularisation) return true;
    if (e.venteLogId && regLogIds.has(e.venteLogId)) return true;
    if (e.ticketNumero && regTickets.has(e.ticketNumero)) return true;
    return false;
  });
}

export type RegGroup = {
  key: string;
  ticketNumero: string | null;
  businessDate: string | null;
  site: HistoriqueEvent["site"];
  events: HistoriqueEvent[];
};

export function groupRegularisationEvents(
  events: HistoriqueEvent[],
): RegGroup[] {
  const linked = filterRegularisationEvents(events);
  const map = new Map<string, RegGroup>();

  for (const ev of linked) {
    const key =
      ev.ticketNumero ??
      (ev.venteLogId ? `ligne-${ev.venteLogId}` : ev.id);
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        ticketNumero: ev.ticketNumero ?? null,
        businessDate: ev.date,
        site: ev.site,
        events: [],
      };
      map.set(key, group);
    }
    group.events.push(ev);
  }

  for (const g of map.values()) {
    g.events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  }

  return [...map.values()].sort((a, b) => {
    const ta = a.events[a.events.length - 1]?.at ?? "";
    const tb = b.events[b.events.length - 1]?.at ?? "";
    return ta < tb ? 1 : ta > tb ? -1 : 0;
  });
}
