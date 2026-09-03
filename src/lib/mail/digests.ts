import {
  digestNotifyEnabled,
  resolveMailAlertRecipients,
} from "@/lib/mail/mail-config";
import { sendMail } from "@/lib/mail/gmail-send";
import { digestMail } from "@/lib/mail/mail-templates";
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

function monthBounds(ym: string): { from: string; to: string; label: string } {
  const [ys, ms] = ym.split("-");
  const y = Number(ys);
  const m = Number(ms);
  const from = `${ys}-${ms}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const to = `${ys}-${ms}-${String(last).padStart(2, "0")}`;
  const label = new Intl.DateTimeFormat("fr-FR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
  return { from, to, label };
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

export async function sendMonthlyDigest(anchorDate = todayIsoDate()): Promise<{
  ok: boolean;
  from: string;
  to: string;
  total: number;
}> {
  if (!digestNotifyEnabled()) {
    return { ok: false, from: "", to: "", total: 0 };
  }
  const recipients = await resolveMailAlertRecipients();
  if (recipients.length === 0) {
    return { ok: false, from: "", to: "", total: 0 };
  }

  const [y, m] = anchorDate.slice(0, 7).split("-").map(Number);
  const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  const ym = `${prev.y}-${String(prev.m).padStart(2, "0")}`;
  const bounds = monthBounds(ym);
  const ca = await caForRange(bounds.from, bounds.to);
  const mail = digestMail({
    kind: "month",
    label: bounds.label,
    from: bounds.from,
    to: bounds.to,
    ...ca,
  });
  const ok = await sendMail({ to: recipients, ...mail });
  return { ok, from: bounds.from, to: bounds.to, total: ca.total };
}
