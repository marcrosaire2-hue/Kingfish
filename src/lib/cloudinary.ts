import { v2 as cloudinary } from "cloudinary";

let configured = false;

function parseCloudinaryUrl(url: string): {
  cloud_name: string;
  api_key: string;
  api_secret: string;
} {
  const match = /^cloudinary:\/\/([^:]+):([^@]+)@([^/\s]+)/.exec(url.trim());
  if (!match) {
    throw new Error(
      "CLOUDINARY_URL invalide (attendu cloudinary://API_KEY:API_SECRET@CLOUD_NAME).",
    );
  }
  const [, api_key, api_secret, cloud_name] = match;
  if (
    api_secret.includes("VOTRE_API_SECRET") ||
    api_secret.includes("<your_api_secret>") ||
    api_secret === "Secret" ||
    api_secret.toLowerCase().includes("secret_de_l")
  ) {
    throw new Error(
      "CLOUDINARY_URL contient encore un placeholder : collez le vrai secret API Cloudinary.",
    );
  }
  return { cloud_name, api_key, api_secret };
}

function ensureCloudinaryConfigured(): void {
  if (configured) return;
  const url = process.env.CLOUDINARY_URL?.trim();
  if (!url) {
    throw new Error(
      "CLOUDINARY_URL manquant dans .env.local (cloudinary://API_KEY:API_SECRET@CLOUD_NAME).",
    );
  }
  const cfg = parseCloudinaryUrl(url);
  cloudinary.config({
    cloud_name: cfg.cloud_name,
    api_key: cfg.api_key,
    api_secret: cfg.api_secret,
    secure: true,
  });
  configured = true;
}

export type CloudinaryUploadResult = {
  url: string;
  publicId: string;
  mime: string;
};

/**
 * Envoie une capture de versement sur Cloudinary (dossier kingfish/versements).
 * Retourne l’URL HTTPS sécurisée à stocker en base.
 */
export async function uploadVersementPreuve(input: {
  bytes: Buffer;
  mime: string;
  versementId: string;
  date: string;
  site: string;
}): Promise<CloudinaryUploadResult> {
  ensureCloudinaryConfigured();

  const dataUri = `data:${input.mime};base64,${input.bytes.toString("base64")}`;
  const result = await cloudinary.uploader.upload(dataUri, {
    folder: "kingfish/versements",
    public_id: `${input.date}_${input.site}_${input.versementId}`,
    resource_type: "image",
    overwrite: false,
    unique_filename: false,
  });

  if (!result.secure_url || !result.public_id) {
    throw new Error("Échec de l’envoi de la capture vers Cloudinary.");
  }

  return {
    url: result.secure_url,
    publicId: result.public_id,
    mime: input.mime,
  };
}
