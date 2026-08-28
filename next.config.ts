import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  // Ne pas divulguer la pile technique dans les réponses.
  poweredByHeader: false,

  async headers() {
    // React / Turbopack utilisent eval() en dev (callstacks, HMR) — interdit
    // en prod, autorisé localement uniquement.
    const scriptSrc = isDev
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self' 'unsafe-inline'";
    const connectSrc = isDev
      ? "connect-src 'self' ws: wss:"
      : "connect-src 'self'";

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
            value: `default-src 'self'; ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; ${connectSrc}; frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self'`,
          },
          // Ne pas fuiter l'origine de navigation vers des sites tiers.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Couper les API navigateur inutiles à une app de gestion.
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
