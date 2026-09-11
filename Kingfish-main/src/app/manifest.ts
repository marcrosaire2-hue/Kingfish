import type { MetadataRoute } from "next";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";

/**
 * Manifeste PWA : permet d'installer la caisse sur l'écran d'accueil des
 * téléphones de salle et de l'ouvrir en plein écran, sans barre d'adresse.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: "King Fish",
    description: APP_TAGLINE,
    start_url: "/vente",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b1a2e",
    theme_color: "#005098",
    lang: "fr",
    icons: [
      {
        src: "/logo-king-fish.jpg",
        sizes: "512x512",
        type: "image/jpeg",
        purpose: "any",
      },
    ],
  };
}
