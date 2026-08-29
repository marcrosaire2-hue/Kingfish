import { redirect } from "next/navigation";

/** Ancienne page Stock — redirigée vers Stock Zogbo. */
export default function Page() {
  redirect("/stock-zogbo");
}
