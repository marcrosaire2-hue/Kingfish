export function formatEcart(value: number | null): string {
  if (value === null) return "—";
  return value > 0 ? `+${value}` : String(value);
}

/** Écart de stock : vert = juste, rouge = manque, ambre = surplus. */
export function EcartBadge({ value }: { value: number | null }) {
  const tone =
    value === null
      ? "ecart-none"
      : value === 0
        ? "ecart-ok"
        : value < 0
          ? "ecart-neg"
          : "ecart-pos";
  return (
    <span className={`stock-ecart ${tone}`}>
      {value === null ? null : <span className="stock-ecart-dot" aria-hidden />}
      {formatEcart(value)}
    </span>
  );
}
