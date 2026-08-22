import { redirect } from "next/navigation";

/** Ancienne URL → page d’accueil (tableau de bord) */
export default function SyntheseRedirectPage() {
  redirect("/");
}
