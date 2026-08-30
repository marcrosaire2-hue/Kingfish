import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import QRCode from "qrcode";
import { formatStickerCode, normalizeStickerCode } from "@/lib/parse-qr-id";

export type QrPrintItem = {
  qrId: string;
  stickerCode: string;
  productName: string;
};

function pdfSafe(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, " ");
}

function stickerOf(item: QrPrintItem): string {
  return (
    normalizeStickerCode(item.stickerCode) ||
    normalizeStickerCode(item.qrId)
  );
}

/** Étiquettes PDF A4 (2 × 4) : nom, QR, code collé. */
export async function buildQrPrintSheetPdf(input: {
  title: string;
  items: QrPrintItem[];
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pageW = 595.28;
  const pageH = 841.89;
  const cols = 2;
  const rows = 4;
  const marginX = 24;
  const marginY = 28;
  const gap = 10;
  const cellW = (pageW - marginX * 2 - gap * (cols - 1)) / cols;
  const cellH = (pageH - marginY * 2 - gap * (rows - 1)) / rows;
  const perPage = cols * rows;

  const ink = rgb(0.07, 0.09, 0.14);
  const line = rgb(0.78, 0.8, 0.84);

  for (let i = 0; i < input.items.length; i++) {
    if (i % perPage === 0) doc.addPage([pageW, pageH]);
    const page = doc.getPage(Math.floor(i / perPage));
    const slot = i % perPage;
    const col = slot % cols;
    const row = Math.floor(slot / cols);
    const x = marginX + col * (cellW + gap);
    const y = pageH - marginY - (row + 1) * cellH - row * gap;

    page.drawRectangle({
      x,
      y,
      width: cellW,
      height: cellH,
      borderColor: line,
      borderWidth: 1,
    });

    const item = input.items[i];
    const name = pdfSafe(item.productName);
    const sticker = formatStickerCode(stickerOf(item));
    const png = await QRCode.toBuffer(item.qrId, {
      type: "png",
      margin: 1,
      width: 220,
      errorCorrectionLevel: "M",
    });
    const image = await doc.embedPng(png);
    const qrSize = 132;
    const qrX = x + (cellW - qrSize) / 2;
    const qrY = y + 42;

    page.drawText(name.slice(0, 42), {
      x: x + 10,
      y: y + cellH - 22,
      size: 11,
      font: fontBold,
      color: ink,
    });
    page.drawImage(image, {
      x: qrX,
      y: qrY,
      width: qrSize,
      height: qrSize,
    });
    page.drawText(sticker, {
      x: x + 10,
      y: y + 18,
      size: 16,
      font: fontBold,
      color: ink,
    });
    page.drawText("Code a coller / a saisir", {
      x: x + 10,
      y: y + 8,
      size: 7,
      font,
      color: rgb(0.4, 0.42, 0.46),
    });
  }

  if (doc.getPageCount() === 0) {
    doc.addPage([pageW, pageH]);
  }

  return doc.save();
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
  return `qr-${slug || "article"}-${input.date}.pdf`;
}
