import { qrSheetFilename } from "@/lib/qr-print-sheet";

/** Télécharge le PDF d’étiquettes pour les QR venant d’être créés. */
export async function downloadQrSheet(input: {
  qrIds: string[];
  productName: string;
  date: string;
}): Promise<void> {
  const qrIds = [...new Set(input.qrIds.filter(Boolean))];
  if (!qrIds.length) return;
  const res = await fetch("/api/stock-units/sheet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      qrIds,
      productName: input.productName,
      date: input.date,
      title: `${input.productName} · ${qrIds.length} QR · ${input.date}`,
    }),
  });
  if (!res.ok) {
    const body = (await res.json()) as { error?: string };
    throw new Error(body.error ?? "Téléchargement des QR impossible.");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = qrSheetFilename({
    productName: input.productName,
    date: input.date,
  });
  anchor.click();
  URL.revokeObjectURL(url);
}
