import { redirect } from "next/navigation";

/** Les formules ont été retirées du produit. */
export default function CombosRedirectPage() {
  redirect("/stock");
}
