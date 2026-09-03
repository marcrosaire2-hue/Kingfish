#!/usr/bin/env node
/**
 * Obtient un refresh token Gmail pour King Fish Manager.
 *
 * Prérequis Google Cloud :
 * 1. Créer un projet → activer « Gmail API »
 * 2. Écran de consentement OAuth (externe ou interne) — scope gmail.send
 * 3. Identifiants → ID client OAuth → type « Application de bureau »
 * 4. Copier CLIENT_ID et CLIENT_SECRET
 *
 * Usage :
 *   GMAIL_CLIENT_ID=... GMAIL_CLIENT_SECRET=... node scripts/gmail-oauth-setup.mjs
 *
 * Puis coller dans Render / .env.local :
 *   GMAIL_CLIENT_ID=
 *   GMAIL_CLIENT_SECRET=
 *   GMAIL_REFRESH_TOKEN=
 *   GMAIL_USER=votre@gmail.com
 *   MAIL_ALERT_TO=destinataire@...
 *   MAIL_SALE_NOTIFY=1
 *   MAIL_DIGEST_NOTIFY=1
 *   MAIL_CRON_SECRET=une-longue-chaine-secrete
 */

import http from "node:http";
import { randomBytes } from "node:crypto";
import { URL } from "node:url";
import { google } from "googleapis";

const CLIENT_ID = process.env.GMAIL_CLIENT_ID?.trim();
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET?.trim();
const PORT = Number(process.env.GMAIL_OAUTH_PORT || 53682);
const REDIRECT = `http://127.0.0.1:${PORT}/oauth2callback`;
const SCOPES = ["https://www.googleapis.com/auth/gmail.send"];

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "Définis GMAIL_CLIENT_ID et GMAIL_CLIENT_SECRET avant de lancer ce script.",
  );
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT);
const authUrl = oauth2.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: SCOPES,
});

console.log("\n=== King Fish · OAuth Gmail ===\n");
console.log("1. Ouvre cette URL dans le navigateur :\n");
console.log(authUrl);
console.log(
  `\n2. Connecte-toi avec le compte Gmail expéditeur, accepte l’envoi de mails.`,
);
console.log(`3. Tu seras redirigé vers ${REDIRECT} — ce script récupère le code.\n`);

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url?.startsWith("/oauth2callback")) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const code = u.searchParams.get("code");
    const err = u.searchParams.get("error");
    if (err) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(`Erreur OAuth : ${err}`);
      server.close();
      process.exit(1);
    }
    if (!code) {
      res.writeHead(400);
      res.end("Code manquant");
      return;
    }
    const { tokens } = await oauth2.getToken(code);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      "<h1>OK</h1><p>Refresh token obtenu. Tu peux fermer cet onglet et revenir au terminal.</p>",
    );
    console.log("\n=== Variables à coller ===\n");
    console.log(`GMAIL_CLIENT_ID=${CLIENT_ID}`);
    console.log(`GMAIL_CLIENT_SECRET=${CLIENT_SECRET}`);
    console.log(`GMAIL_REFRESH_TOKEN=${tokens.refresh_token || "(aucun — réessaie avec prompt=consent)"}`);
    console.log(`GMAIL_USER=ton.adresse@gmail.com`);
    console.log(`MAIL_ALERT_TO=destinataire@exemple.com`);
    console.log(`MAIL_SALE_NOTIFY=1`);
    console.log(`MAIL_DIGEST_NOTIFY=1`);
    console.log(`MAIL_CRON_SECRET=${randomBytes(24).toString("base64url")}`);
    console.log("\n");
    if (!tokens.refresh_token) {
      console.warn(
        "Pas de refresh_token : révoque l’accès de l’app sur https://myaccount.google.com/permissions puis relance.",
      );
    }
    server.close();
    process.exit(0);
  } catch (e) {
    console.error(e);
    res.writeHead(500);
    res.end("Erreur");
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`En écoute sur ${REDIRECT} …\n`);
});
