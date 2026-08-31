import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

function contentSecurityPolicy(): string {
  const scriptSrc = isDev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'";
  const connectSrc = isDev
    ? "connect-src 'self' ws: wss:"
    : "connect-src 'self'";

  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://res.cloudinary.com",
    "font-src 'self' data:",
    connectSrc,
    "frame-ancestors 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

const nextConfig: NextConfig = {
  // Ne pas divulguer la pile technique dans les réponses.
  poweredByHeader: false,

  // Évite un crash au « Collecting page data » sur Render : ces paquets
  // Node doivent rester externes (pas rebundlés par Turbopack).
  serverExternalPackages: ["cloudinary", "mongodb"],

  async headers() {
    // En local, pas de CSP : React/Turbopack ont besoin de eval() et le HMR
    // WebSocket doit suivre le port réel du serveur (évite les erreurs 3001).
    if (process.env.NODE_ENV === "development") {
      return [];
    }

    return [
      {
        source: "/(.*)",
        headers: [
          // Forcer HTTPS une fois derrière Render (le navigateur mémorise).
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          // Empêcher le navigateur de deviner un type MIME (pièges XSS).
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Interdire l'encapsulation de l'app dans une iframe (clickjacking) ;
          // self autorisé pour l'aperçu d'impression des tickets.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Content-Security-Policy",
            value: contentSecurityPolicy(),
          },
          // Ne pas fuiter l'origine de navigation vers des sites tiers.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Couper les API navigateur inutiles à une app de gestion.
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=(), payment=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
