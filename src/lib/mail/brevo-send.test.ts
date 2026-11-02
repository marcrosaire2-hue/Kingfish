import { describe, expect, it } from "vitest";
import { buildBrevoPayload } from "@/lib/mail/brevo-send";
import { MAIL_LOGO_CID } from "@/lib/mail/mail-templates";

describe("buildBrevoPayload", () => {
  it("formate expéditeur et destinataires pour l'API Brevo", () => {
    const payload = buildBrevoPayload(
      { to: ["a@x.bj", "b@x.bj"], subject: "S", text: "T", html: "<p>H</p>" },
      { name: "King Fish", email: "no-reply@x.bj" },
    );
    expect(payload.sender).toEqual({ name: "King Fish", email: "no-reply@x.bj" });
    expect(payload.to).toEqual([{ email: "a@x.bj" }, { email: "b@x.bj" }]);
    expect(payload.htmlContent).toBe("<p>H</p>");
    expect(payload.textContent).toBe("T");
  });

  it("retire le logo CID, non supporté par Brevo, sans URL publique", () => {
    const prev = process.env.APP_PUBLIC_URL;
    delete process.env.APP_PUBLIC_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.RENDER_EXTERNAL_URL;
    const payload = buildBrevoPayload(
      {
        to: ["a@x.bj"],
        subject: "S",
        text: "T",
        html: `<img src="cid:${MAIL_LOGO_CID}" width="72" /><p>ok</p>`,
      },
      { name: "N", email: "e@x.bj" },
    );
    expect(payload.htmlContent).toBe("<p>ok</p>");
    if (prev !== undefined) process.env.APP_PUBLIC_URL = prev;
  });
});
