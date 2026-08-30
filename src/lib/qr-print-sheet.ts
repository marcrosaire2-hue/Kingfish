import QRCode from "qrcode";

export type QrPrintItem = {
  qrId: string;
  productName: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Feuille HTML imprimable (ou « Enregistrer sous » → PDF) avec tous les QR. */
export async function buildQrPrintSheetHtml(input: {
  title: string;
  items: QrPrintItem[];
}): Promise<string> {
  const cells = await Promise.all(
    input.items.map(async (item) => ({
      ...item,
      dataUrl: await QRCode.toDataURL(item.qrId, {
        margin: 1,
        width: 220,
        errorCorrectionLevel: "M",
      }),
    })),
  );

  const body = cells
    .map(
      (cell) => `
      <article class="qr-label">
        <p class="qr-product">${escapeHtml(cell.productName)}</p>
        <img src="${cell.dataUrl}" alt="QR ${escapeHtml(cell.qrId)}" width="220" height="220" />
        <p class="qr-id">${escapeHtml(cell.qrId)}</p>
      </article>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(input.title)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 1rem;
      font-family: system-ui, sans-serif;
      color: #111;
    }
    h1 {
      margin: 0 0 1rem;
      font-size: 1.1rem;
      font-weight: 700;
    }
    .qr-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 1rem;
    }
    .qr-label {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.35rem;
      padding: 0.75rem;
      border: 1px solid #ddd;
      border-radius: 10px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .qr-product {
      margin: 0;
      font-size: 0.95rem;
      font-weight: 700;
      text-align: center;
    }
    .qr-id {
      margin: 0;
      font-family: ui-monospace, monospace;
      font-size: 0.78rem;
      word-break: break-all;
      text-align: center;
    }
    @media print {
      body { padding: 0.5rem; }
      .qr-label { border-color: #ccc; }
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(input.title)}</h1>
  <div class="qr-grid">${body}</div>
</body>
</html>`;
}

export function qrSheetFilename(input: {
  productName: string;
  date: string;
}): string {
  const slug = input.productName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `qr-${slug || "plat"}-${input.date}.html`;
}
