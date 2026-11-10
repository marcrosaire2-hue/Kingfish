import { reportError } from "@/lib/report-error";
import type { StockEvent } from "@/lib/stock-ledger";
import { appendStockEvents } from "@/lib/stock-ledger-repo";

/**
 * Double écriture vers le journal de stock.
 *
 * Pendant la bascule, les anciens compteurs restent la référence de lecture :
 * une panne du journal ne doit donc pas bloquer une vente ou une perte. En
 * revanche l'erreur est journalisée (et Sentry si configuré) pour être
 * visible. `STOCK_LEDGER_STRICT=1` propage l'erreur (tests, réparation).
 */
export async function recordStockEvents(
  events: readonly StockEvent[],
  operation: string,
): Promise<void> {
  if (events.length === 0) return;
  try {
    await appendStockEvents(events);
  } catch (error) {
    if (process.env.STOCK_LEDGER_STRICT === "1") throw error;
    reportError(operation, error, {
      evenements: events.length,
      site: events[0]!.site,
      famille: events[0]!.family,
    });
  }
}
