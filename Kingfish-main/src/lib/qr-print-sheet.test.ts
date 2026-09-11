import { describe, expect, it } from "vitest";
import { buildQrPrintSheetPdf, qrSheetFilename } from "@/lib/qr-print-sheet";

describe("qr-print-sheet", () => {
  it("builds a PDF with the QR labels", async () => {
    const pdf = await buildQrPrintSheetPdf({
      title: "Poulet · 2 QR",
      items: [
        { qrId: "KF-A7K3Q2", stickerCode: "A7K3Q2", productName: "Poulet" },
        { qrId: "KF-B8M4R3", stickerCode: "B8M4R3", productName: "Poulet" },
      ],
    });
    expect(pdf.byteLength).toBeGreaterThan(200);
    expect(Buffer.from(pdf.subarray(0, 5)).toString("ascii")).toBe("%PDF-");
  });

  it("slugifies product names for filenames", () => {
    expect(
      qrSheetFilename({ productName: "Poulet Braisé", date: "2026-08-30" }),
    ).toBe("qr-poulet-braise-2026-08-30.pdf");
  });
});
