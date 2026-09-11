import { redirect } from "next/navigation";

/** Ancienne URL Approvisionnement — redirigée vers Achats. */
export default function Page() {
  redirect("/achats");
}
