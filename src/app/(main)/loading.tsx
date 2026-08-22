/**
 * Attente légère pendant le chargement d'une page : le menu et l'en-tête
 * restent visibles (layout persistant).
 */
export default function MainLoading() {
  return (
    <div className="page-content-loading" aria-busy="true" aria-label="Chargement">
      <div className="page-content-loading-line" />
      <div className="page-content-loading-line short" />
      <div className="page-content-loading-block" />
    </div>
  );
}
