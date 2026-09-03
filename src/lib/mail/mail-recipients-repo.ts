import { getDb } from "@/lib/mongodb";

const DOC_ID = "mail_alerts";

export type MailAlertsDoc = {
  _id: string;
  emails: string[];
  updatedAt: string;
  updatedBy?: string | null;
};

function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function normalizeMailList(raw: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const email = normalizeEmail(item);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

/** Destinataires stockés en base (liste gérée par Marc). */
export async function getMailAlertEmails(): Promise<string[]> {
  const db = await getDb();
  const doc = await db
    .collection<MailAlertsDoc>("app_settings")
    .findOne({ _id: DOC_ID });
  return normalizeMailList(doc?.emails ?? []);
}

export async function setMailAlertEmails(input: {
  emails: string[];
  updatedBy?: string | null;
}): Promise<string[]> {
  const emails = normalizeMailList(input.emails);
  const now = new Date().toISOString();
  const db = await getDb();
  await db.collection<MailAlertsDoc>("app_settings").updateOne(
    { _id: DOC_ID },
    {
      $set: {
        emails,
        updatedAt: now,
        updatedBy: input.updatedBy ?? null,
      },
      $setOnInsert: { _id: DOC_ID },
    },
    { upsert: true },
  );
  return emails;
}

export async function addMailAlertEmail(input: {
  email: string;
  updatedBy?: string | null;
}): Promise<{ emails: string[]; added: boolean }> {
  const email = normalizeEmail(input.email);
  if (!email) {
    throw new Error("Adresse e-mail invalide.");
  }
  const current = await getMailAlertEmails();
  if (current.includes(email)) {
    return { emails: current, added: false };
  }
  const emails = await setMailAlertEmails({
    emails: [...current, email],
    updatedBy: input.updatedBy,
  });
  return { emails, added: true };
}

export async function removeMailAlertEmail(input: {
  email: string;
  updatedBy?: string | null;
}): Promise<string[]> {
  const email = normalizeEmail(input.email);
  if (!email) {
    throw new Error("Adresse e-mail invalide.");
  }
  const current = await getMailAlertEmails();
  return setMailAlertEmails({
    emails: current.filter((e) => e !== email),
    updatedBy: input.updatedBy,
  });
}
