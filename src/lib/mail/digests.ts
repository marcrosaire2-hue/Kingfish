import {
  digestNotifyEnabled,
  resolveMailAlertRecipients,
} from "@/lib/mail/mail-config";
import { sendMail } from "@/lib/mail/gmail-send";
import {
  detailedSalesDigestMail,
  digestMail,
} from "@/lib/mail/mail-templates";
import {
  buildDailySalesDigest,
  buildMonthlySalesDigest,
} from "@/lib/mail/sales-digest-data";
import { shiftIsoDate, todayIsoDate } from "@/lib/zogbo-calc";
import { sumCaByShiftRange } from "@/lib/vente-repo";

function mondayOf(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  dt.setUTCDate(dt.getUTCDate() + diff);
  return dt.toISOString().slice(0, 10);
}

async function caForRange(from: string, to: string) {
  const [zogbo, gbegamey] = await Promise.all([
    sumCaByShiftRange(from, to, "zogbo"),
    sumCaByShiftRange(from, to, "gbegamey"),
  ]);
  return {
    zogbo: zogbo.totals.total,
    gbegamey: gbegamey.totals.total,
    total: zogbo.totals.total + gbegamey.totals.total,
  };
}

/**
 * Point de la journée écoulée (par défaut : hier).
 * À déclencher chaque nuit via cron `?kind=day`.
 */
export async function sendDailyDigest(
  anchorDate = todayIsoDate(),
  opts?: { date?: string },
): Promise<{
  ok: boolean;
  from: string;
  to: string;
  total: number;
  articles: number;
}> {
  if (!digestNotifyEnabled()) {
    return { ok: false, from: "", to: "", total: 0, articles: 0 };
  }
  const recipients = await resolveMailAlertRecipients();
  if (recipients.length === 0) {
    return { ok: false, from: "", to: "", total: 0, articles: 0 };
  }

  const date =
    opts?.date && /^\d{4}-\d{2}-\d{2}$/.test(opts.date)
      ? opts.date
      : (shiftIsoDate(anchorDate, -1) ?? anchorDate);

  const report = await buildDailySalesDigest(date);
  const mail = detailedSalesDigestMail(report);
  const ok = await sendMail({ to: recipients, ...mail });
  return {
    ok,
    from: report.from,
    to: report.to,
    total: report.total,
    articles: report.articles,
  };
}

export async function sendWeeklyDigest(anchorDate = todayIsoDate()): Promise<{
  ok: boolean;
  from: string;
  to: string;
  total: number;
}> {
  if (!digestNotifyEnabled()) {
    return { ok: false, from: "", to: "", total: 0 };
  }
  const recipients = await resolveMailAlertRecipients();
  if (recipients.length === 0) return { ok: false, from: "", to: "", total: 0 };

  const thisMonday = mondayOf(anchorDate);
  const prevMonday = shiftIsoDate(thisMonday, -7)!;
  const prevSunday = shiftIsoDate(thisMonday, -1)!;
  const ca = await caForRange(prevMonday, prevSunday);
  const label = `${prevMonday} → ${prevSunday}`;
  const mail = digestMail({
    kind: "week",
    label,
    from: prevMonday,
    to: prevSunday,
    ...ca,
  });
  const ok = await sendMail({ to: recipients, ...mail });
  return { ok, from: prevMonday, to: prevSunday, total: ca.total };
}

/**
 * Point mensuel détaillé du mois civil précédent
 * (par défaut : 1er du mois → mois précédent).
 */
export async function sendMonthlyDigest(
  anchorDate = todayIsoDate(),
  opts?: { ym?: string },
): Promise<{
  ok: boolean;
  from: string;
  to: string;
  total: number;
  articles: number;
}> {
  if (!digestNotifyEnabled()) {
    return { ok: false, from: "", to: "", total: 0, articles: 0 };
  }
  const recipients = await resolveMailAlertRecipients();
  if (recipients.length === 0) {
    return { ok: false, from: "", to: "", total: 0, articles: 0 };
  }

  let ym = opts?.ym;
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) {
    const [y, m] = anchorDate.slice(0, 7).split("-").map(Number);
    const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
    ym = `${prev.y}-${String(prev.m).padStart(2, "0")}`;
  }

  const report = await buildMonthlySalesDigest(ym);
  const mail = detailedSalesDigestMail(report);
  const ok = await sendMail({ to: recipients, ...mail });
  return {
    ok,
    from: report.from,
    to: report.to,
    total: report.total,
    articles: report.articles,
  };
}
