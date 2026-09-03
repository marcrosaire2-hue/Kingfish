type CloudinaryApi = {
  config: (cfg: {
    cloud_name: string;
    api_key: string;
    api_secret: string;
    secure?: boolean;
  }) => void;
  uploader: {
    upload: (
      file: string,
      options: Record<string, unknown>,
    ) => Promise<{ secure_url?: string; public_id?: string }>;
  };
};

let configured = false;
let cloudinaryApi: CloudinaryApi | null = null;

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

/** True si CLOUDINARY_URL est renseigné (hors placeholder). */
export function cloudinaryConfigured(): boolean {
  const url = process.env.CLOUDINARY_URL?.trim();
  if (!url) return false;
  try {
    parseCloudinaryUrl(url);
    return true;
  } catch {
    return false;
  }
}

async function getCloudinary(): Promise<CloudinaryApi> {
  if (cloudinaryApi && configured) return cloudinaryApi;

  const url = process.env.CLOUDINARY_URL?.trim();
  if (!url) {
    throw new Error(
      "CLOUDINARY_URL manquant (cloudinary://API_KEY:API_SECRET@CLOUD_NAME).",
    );
  }
  const cfg = parseCloudinaryUrl(url);
  const mod = await import("cloudinary");
  const api = mod.v2 as unknown as CloudinaryApi;
  api.config({
    cloud_name: cfg.cloud_name,
    api_key: cfg.api_key,
    api_secret: cfg.api_secret,
    secure: true,
  });
  cloudinaryApi = api;
  configured = true;
  return api;
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
  const cloudinary = await getCloudinary();

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
