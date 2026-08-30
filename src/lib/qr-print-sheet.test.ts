import { describe, expect, it } from "vitest";
import { buildQrPrintSheetHtml, qrSheetFilename } from "@/lib/qr-print-sheet";

describe("qr-print-sheet", () => {
  it("builds an HTML sheet with all QR ids", async () => {
    const html = await buildQrPrintSheetHtml({
      title: "Poulet · 2 QR",
      items: [
        { qrId: "KF-TEST-1", productName: "Poulet" },
        { qrId: "KF-TEST-2", productName: "Poulet" },
      ],
    });
    expect(html).toContain("KF-TEST-1");
    expect(html).toContain("KF-TEST-2");
    expect(html).toContain("data:image/png;base64,");
  });

  it("slugifies product names for filenames", () => {
    expect(
      qrSheetFilename({ productName: "Poulet Braisé", date: "2026-08-30" }),
    ).toBe("qr-poulet-braise-2026-08-30.html");
  });
});
