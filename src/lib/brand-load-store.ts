type BrandLoadState = {
  count: number;
  label: string;
};

type Listener = () => void;

let count = 0;
let label = "Chargement…";
let snapshot: BrandLoadState = { count: 0, label: "Chargement…" };
const listeners = new Set<Listener>();

function emit() {
  snapshot = { count, label };
  for (const fn of listeners) fn();
}

export function getBrandLoadSnapshot(): BrandLoadState {
  return snapshot;
}

export function subscribeBrandLoad(fn: Listener) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Compte les loaders actifs. Un relâchement est différé d’un tick pour que
 *  le loader de la page prenne le relais sans démonter la scène. */
export function acquireBrandLoad(nextLabel?: string) {
  count += 1;
  if (nextLabel) label = nextLabel;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    queueMicrotask(() => {
      count = Math.max(0, count - 1);
      emit();
    });
  };
}
