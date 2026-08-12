# État actuel des 4 zones (snapshot du 2026-08-12)

Enregistré avant modifications. Branche courante, commit `12f3f11`.

## 1. Page vente — quantités (`src/components/vente/vente-page.tsx` + `src/lib/vente-repo.ts`)

Modifications **non commitées** dans les deux fichiers.

### Panier (mode POS, `mode === "pos"`)
- `addToCart(product, unitPriceOverride?)` : clé de ligne = `kind:productId:unitPrice` (vente-page.tsx:376) ;
  ajout d'une unité si la ligne existe déjà, sinon nouvelle ligne `qty: 1`.
- `changeCartQty(key, delta)` : +/-1 unité, suppression si `qty <= 0` (vente-page.tsx:397).
- `cartTotal = Σ qty × unitPrice` ; `reductionN` plafonné à `[0, cartTotal]` ; `cartNet = cartTotal - reductionN`.
- Validation : `POST /api/pos` action `validate`, lignes `{kind, productId, name, qty, unitPrice}`.
- Ventes rapides : `sell(product, qty=1, unitPrice?)` → `POST /api/vente` action `sell`, clé busy `kind:productId:qty`, flash `+qty`.

### Composeur plat + accompagnements (nouveau, non commité)
- Plats = catalogue paramètres (`parametres.baseDishes`), **plus** limités au catalogue statique (`getZogboPlat`) :
  seuls les plats du catalogue statique restreignent leur liste d'accompagnements; les plats réels proposent tous les accompagnements du jour.
- Prix accompagnement : `accPriceFor(acc)` = grille « plat+acc » (`accompanimentUnitPrice`) si plat statique, sinon prix du jour.
- `composerTotal` = prix du plat + Σ prix des accompagnements sélectionnés (via `composerAccOptions` filtrés).
- Passage en panier : chaque accompagnement ajouté séparément avec son prix de grille ; mode rapide : `sell(acc, 1, accPriceFor(acc))`.

### Repo (`src/lib/vente-repo.ts`, non commité)
- `getVenteBoard` Zogbo : grille construite depuis **les paramètres** (`baseDishes`, `localDishes`) au lieu du catalogue statique ; stock accompagnements = initial + préparés − vendus − **pertes**.
- `recordVente` : prix accompagnement légal si `== target.unitPrice` (prix du jour) **ou** `isLegalAccompanimentPrice` (grilles 500/1 000).
- `recordVente(input {date, site, kind, productId, qty=1, unitPrice?, actor?})` → `{entry, soldToday, board}` ; rejette `qty <= 0`.
- `recordExtraVente({date, site, description, unitPrice, actor?})` ; `undoVente({id, date, site, actor?})` (annule si `cancelledAt: null`).

### DB aujourd'hui (2026-08-12)
- `pos_tickets`: **0**, `aquapro_tickets`: **0**, `ventes_log`: **5 lignes**, source `carnet-zogbo-1208-matin`, montant 4 350 F.
- Aucune vente POS ni caisse rapide ordinaire aujourd'hui : seule la saisie du carnet matrice du matin Zogbo (script `import-ventes-matin-zogbo-1208.mjs`).

## 2. Login — fond (`src/components/login/login-page.tsx`, `src/app/login/page.tsx`, `src/app/globals.css`)
- Fond `.login-screen` (globals.css:1726) : `background-color: #0b1a2e` + dégradé `linear-gradient(160deg, #005098 52% → #0b1a2e)` par-dessus `url("/bg-login.jpg")` (`public/bg-login.jpg`), `background-size: cover; position: center`.
- `body:has(.login-screen)` = `#0b1a2e` (globals.css:68).
- `.login-card` : 420px max, surface 96 % + blur 12px, rayon 24px, anneau doré via `--accent`, ombres claire/dark.
- `.login-brand` centré : logo 5,5rem rond sur fond blanc, titre `APP_NAME`, `APP_TAGLINE`, `APP_SITES_LABEL`.
- Champs : identifiant / mot de passe avec œil (`showPassword`), `autoComplete`, `enterKeyHint`, autoFocus ; erreur en bandeau rouge `login-error` ; `POST /api/auth/login`, redirection `next` → `body.home`.
- Responsive mobile (globals.css:4577) : carte identique, inputs ≥ 16px (anti-zoom iOS), bouton hauteur ≥ 3,35rem.

## 3. Admin / audit (`src/components/admin/admin-page.tsx`, `src/app/admin/page.tsx`)
- `AdminPage` : **gestion de comptes et de zones** — pas de module « audit » dans la page (aucune occurrence du mot audit dans le composant).
- Deux niveaux : admin de zone (Zogbo / Gbégamey, comptes de sa zone uniquement) et administrateur global (les deux sites, crée les admins de zone) ; bannière `admin-site-banner` expliquant les niveaux, note si connecté en admin de zone.
- Sections : « Nouvel utilisateur » (panel), « Création groupée » (panel-wide), « Utilisateurs (N) » (tableau : Identifiant / Nom / Rôle·périmètre / Site), « Accès rapide » (hub → Tableau de bord).
- Export Excel des utilisateurs (`ExportExcelButton` → `exportAdminUsersExcel`).
- L'historique d'audit est ailleurs : page « Registre » (voir §4) qui remonte ventes, caisse, POS, stocks, paramètres par compte.

## 4. Historique (`src/app/historique`, `src/app/historique-ventes`)
### Registre (`historique-page.tsx`, API `/api/historique`, repo `ventes-history-repo.ts`)
- Titre « Registre » — « Tous les mouvements liés au compte qui les a effectués : ventes, caisse, POS, stocks, paramètres. »
- Filtres : `from`/`to` (défaut = début de mois → aujourd'hui), `kind` (all), `site` (all, verrouillé si admin de zone), `actorId`, recherche `q`, limite 300 ; export Excel.
- Lignes : heure (`formatWhen`), badge `hist-kind-*`, titre, détail ; classe `hist-row hist-kind-${kind}` ; classe de fond `main-bg-registre`.

### Historique des ventes (`historique-ventes-page.tsx`, API `/api/historique-ventes`)
- Titre « Historique des ventes », sous-titre « Tous les tickets (King Fish + AquaPro) avec filtres — CA = tickets Validé uniquement. »
- Filtres : période, site, `statut` (défaut `valide`), `source` (`all | kingfish | aquapro`), serveur, paiement, recherche ; limite 300.
- Totaux : count, montant, valide, annulé, en cours (`dash-ca-final hist-ventes-totaux`).
- Tableau : n° ticket, statut, source (badge « AquaPro » / « KF »), serveur, paiement, montant ; lignes dépliables (`expanded`) `hist-ventes-lines`.
- Repo `ventes-history-repo.ts` : source `kingfish` (tickets POS) et `aquapro`, filtres/facets serveurs + paiements.