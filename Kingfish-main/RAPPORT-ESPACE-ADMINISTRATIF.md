# Rapport d'analyse — Espace administratif King Fish Manager

Document de diagnostic, sans aucune modification de code. Snapshot du dépôt au **13/08/2026**, commit de base `5d4aab4`. Chaque affirmation ci-dessous a été vérifiée en lisant le code source actuel (pages, API, repos Mongo) au moment de la rédaction — plusieurs fichiers ayant été modifiés en parallèle pendant la session, la relecture a été refaite intégralement plutôt que de se fier à une mémoire de conversation.

---

## Résumé exécutif

L'espace « Quotidien » (Vente, Caisse, Zogbo, Gbégamey, Achats, Pertes) forme une chaîne cohérente : une vente POS crédite la caisse de la zone en un seul mouvement atomique, les pertes reprennent le stock correctement, et les deux zones partagent un même catalogue de produits. L'architecture a bien absorbé la refonte récente du modèle de caisse (coffre central + une caisse par zone).

Trois points appellent une décision avant toute fusion :

1. **Les Combos ont perdu leur interface** sans que la donnée soit retirée — `/combos` redirige vers un onglet qui n'existe plus, le composant qui les gérait a été supprimé, mais `combos_jours` continue d'alimenter le CA affiché partout (tableau de bord, compte de résultat). C'est un angle mort actif, pas un doublon à trancher.
2. **Zogbo et Gbégamey gèrent les accompagnements en parallèle**, avec le même type de données (`GbegameyLocalLine`) et la même fonction de calcul, mais deux tableaux distincts, deux formulaires distincts, et une différence de comportement stock (Zogbo distingue « pas encore inventorié » de « stock à zéro », Gbégamey non — voir §D).
3. **La page Achats a déjà absorbé deux anciennes pages** (Appro et Matières) sans que Pertes ni Vente aient bougé en miroir — c'est un précédent utile pour juger la suite : la fusion a fonctionné parce que les deux pages partageaient déjà la même donnée (`matieres_jours`), pas parce que fusionner simplifie en soi.

---

## A. Cartographie complète de l'espace administratif

### A.1 Toutes les pages existantes

| Route | Libellé menu | Groupe | Rôle en une ligne |
|---|---|---|---|
| `/` | Tableau de bord | Accueil | Synthèse CA — vue complète (admin) ou réduite au jour (gérant/équipe) |
| `/compte-resultat` | Compte de résultat | Accueil | Produits/charges/résultat, admin seul |
| **`/vente`** | **Vente** | **Quotidien** | **Poste de vente (POS) — catalogue, panier, ticket, facture** |
| **`/caisse`** | **Caisse** | **Quotidien** | **Ouverture/clôture des trois caisses (centrale, Zogbo, Gbégamey), mouvements, versements** |
| **`/zogbo`** | **Zogbo** | **Quotidien** | **Production : plats, accompagnements, boissons, envois vers Gbégamey, journal des ventes** |
| **`/gbegamey`** | **Gbégamey** | **Quotidien** | **Réception : plats reçus de Zogbo, accompagnements sur place, boissons** |
| **`/appro`** (menu : « Achats ») | **Achats** | **Quotidien** | **Dépenses de caisse + achats de matières premières (fusion Appro + Matières)** |
| **`/pertes`** | **Pertes** | **Quotidien** | **Déclaration de sorties de stock sans vente (plats, sur place, boissons, matières)** |
| `/historique-ventes` | Historique ventes | Pilotage | Tickets POS + ventes importées (AquaPro), filtrables |
| `/equipes` | Équipes | Pilotage | Répartition du CA par équipe (jour/nuit) |
| `/controle` | Contrôle | Pilotage | Vérification des ouvertures de stock entre zones |
| `/stock` | Stock | Pilotage | Vue de synthèse du stock, alertes de rupture |
| `/historique` | Registre | Pilotage | Journal d'audit — tous les événements par compte |
| `/parametres` | Paramètres | Pilotage | Catalogue (plats, accompagnements, boissons, combos, matières), admin |
| `/reglages` | Réglages POS | Pilotage | Config du POS (paiements, tables, fournisseurs, entreprise) |
| `/reprise` | Reprise historique | Pilotage | Écriture directe de compteurs de stock/ventes — admin seul |
| `/guide` | Guides | Pilotage | Aide contextuelle par écran |
| `/admin` | Admin | Compte | Gestion des comptes utilisateurs et des zones |
| `/login` | — | — | Authentification |
| `/combos` | — | *(orpheline)* | Redirige vers `/zogbo?tab=combos`, un onglet qui n'existe plus (voir §D.1) |
| `/boissons` | — | *(orpheline probable)* | À vérifier — aucun lien de menu ne pointe dessus ; les boissons se gèrent depuis l'onglet Boissons de Zogbo/Gbégamey |

### A.2 Accès par rôle (qui voit quoi)

| Rôle | Pages Quotidien visibles |
|---|---|
| `vendeur` | Vente, Caisse |
| `cuisine` | Zogbo *(ou Gbégamey selon la zone du compte)*, Achats, Pertes |
| `equipier` | Vente, Caisse, Zogbo/Gbégamey, Achats, Pertes |
| `gerant` | Vente, Caisse, Zogbo, Gbégamey, Achats, Pertes, Stock, Historique ventes |
| `admin` | Tout, plus Compte de résultat, Paramètres, Réglages, Contrôle, Registre, Reprise, Admin |

Un compte rattaché à une zone (`site: "zogbo"` ou `"gbegamey"`) ne voit jamais l'autre zone, ni la caisse centrale (réservée gérant/admin). C'est une règle appliquée à trois endroits différents et de façon cohérente : le menu (`auth-types.ts`), l'accès caisse (`caisse-model.ts`), et le filtre des données (`scopeSite` dans chaque API).

### A.3 Dépendances techniques entre les 7 pages du Quotidien

```
Paramètres (catalogue) ──┬──► Vente (POS)
                          ├──► Zogbo
                          ├──► Gbégamey
                          ├──► Achats (matières)
                          └──► Pertes

Vente ──POST /api/pos──► Caisse (crédite la caisse de zone)
Vente ──lit stockLeft──◄ Zogbo (plats), Gbégamey (plats reçus), Zogbo/Gbégamey (accompagnements)

Zogbo ──« Envoyer »──► Gbégamey (transferLines + sentByProductId)
Zogbo, Gbégamey ──sold──◄ Vente (journal ventes_log, agrégé par produit/jour/site)

Achats (Dépenses) ──POST /api/achats──► Caisse (mouvement kind=depense)
Achats (Stock) ──POST /api/matieres──► matieres_jours (achats, hors caisse)

Pertes ──POST /api/pertes──► Zogbo/Gbégamey (stock plats/accompagnements) OU matieres_jours
Pertes ──lit stockLeft──◄ Vente (catalogue du jour, pour les plats/accompagnements/boissons)

Caisse ──sumCaisseDepensesRecettes──► Compte de résultat, Tableau de bord
```

Aucune de ces 7 pages n'importe directement le composant d'une autre — le couplage passe systématiquement par l'API et Mongo, jamais par du code React partagé entre pages (les seuls composants partagés sont des briques d'affichage : `ZoneBoissonsPanel`, `ZoneVentesPanel`, `BrandLoader`, `QtyInput`, `ProductIcon`). C'est une architecture saine pour une fusion éventuelle : fusionner deux pages ne casserait pas une troisième par un import caché.

---

## B. Analyse détaillée, page par page

### B.0 « Quotidien » — la section elle-même

**Fonction.** Ce n'est pas une page mais un regroupement de menu (`groupLabel: "Quotidien"` sur le premier élément, `app-shell.tsx`). Il rassemble les six écrans qu'un compte utilise pendant le service, par opposition à « Pilotage » (analyse a posteriori) et « Compte » (administration). Aucune donnée ni logique ne lui est propre.

---

### B.1 Vente (`/vente`, `vente-page.tsx`, 1427 lignes)

**1. Fonction de la page**
Poste de vente (POS) pour une zone à la fois (Zogbo ou Gbégamey selon les droits du compte). L'utilisateur y compose un panier (plats + accompagnements via un « composeur », boissons à l'unité, ventes libres), valide une commande qui devient un ticket, et peut imprimer la facture détaillée. Un second usage existait (« mode Rapide », +1/-1 sans panier) — **il a été retiré cette session** : toute vente passe désormais par le panier et crédite obligatoirement une caisse.

**2. Données utilisées**
- Sources : `GET /api/vente` (catalogue du jour + CA + journal récent) et `GET /api/pos` (config POS, caisse active, tickets du jour), interrogées en parallèle au chargement.
- Collections lues : `parametres` (catalogue), `zogbo_jours`/`gbegamey_jours` (stock plats/accompagnements), `boissons_jours` (stock boissons), `ventes_log` (journal), `caisses_sessions` (caisse active), `pos_config` (paiements, entreprise).
- Écriture : `POST /api/pos` (action `validate`) crée un ticket et déclenche `recordVente` produit par produit ; `POST /api/vente` (action `undo`) annule une ligne du journal.
- Champs principaux : `VenteProduct.stockLeft` (nombre ou `null` = non bloqué), `PosTicket.lines[]`, `CaisseSession.totalVente`.

**3. Flux et interactions**
- **Impact sur la caisse** : chaque ticket validé appelle `addCaisseVenteAmount(caisse.id, montant)` dans la même transaction logique que l'écriture des lignes de vente ; si l'écriture du ticket échoue après que des lignes ont été enregistrées, un rollback reprend ces lignes (`pos-repo.ts`, corrigé cette session — voir Registre de la session).
- **Rupture de stock** : une bannière et une alerte transitoire signalent les produits à zéro ; les accompagnements ne sont **jamais** bloqués (`kind !== "local"` dans tous les contrôles de stock), volontairement, le temps que le stock réel y soit maîtrisé.
- **Hors ligne** : une file d'attente locale (`offline-queue.ts`) rejoue les ventes encaissées pendant une coupure réseau, avec une référence d'idempotence posée dès le premier envoi pour éviter un double encaissement.

**4. Analyse technique**
- Un seul fichier de 1427 lignes, aucun sous-composant extrait pour le panier, le composeur ou la facture — trois blocs logiquement séparables qui pourraient devenir des composants indépendants sans changer le comportement.
- `printTicket` construit du HTML par concaténation de chaînes avec échappement manuel (`esc()`) — fonctionnel et déjà sécurisé, mais fragile si de nouveaux champs sont ajoutés sans y penser.
- Dépendance directe à `catalog-zogbo.ts` (catalogue statique historique, prix de grille plat+accompagnement) en plus du catalogue réel de `parametres` — deux sources de vérité pour le prix d'un accompagnement selon le plat choisi.
- Aucun problème de performance identifié : deux fetch parallèles au chargement, pas de N+1.

**5. Analyse fonctionnelle détaillée**
- **Affiché** : CA du jour, répartition jour/nuit, alertes de rupture, panier, tickets du jour, historique récent en tiroir.
- **Calculs** : total panier, réduction plafonnée au total, prix d'un accompagnement selon le plat (grille statique ou prix catalogue).
- **Filtres** : date, site (si le compte a accès aux deux), catégorie de produit.
- **Exports** : Excel du jour (`exportVenteExcel`).
- **Statistiques produites** : aucune agrégée sur place — le CA du jour et par équipe sont affichés, tout le reste (classements, marges) est calculé ailleurs (Tableau de bord).
- **Limitation observée** : le lien « Historique » n'apparaît que si le compte a accès à `/historique-ventes` (`canViewHistory`), ce qui est cohérent, mais aucun message n'explique son absence à un vendeur — juste un bouton en moins.

---

### B.2 Caisse (`/caisse`, `caisse-page.tsx`, 713 lignes)

**1. Fonction de la page**
Ouverture, mouvements (dépense/recette hors ticket), versements entre caisses, et clôture des **trois caisses du réseau** : le coffre central et une caisse par zone. Depuis la refonte de cette session, une caisse est un tiroir partagé par toute la zone (plus une session par vendeur) : qui l'ouvre l'ouvre pour tout le monde.

**2. Données utilisées**
- Source : `GET /api/caisse` (session active de la caisse demandée, historique, vue d'ensemble des trois caisses si le compte y a accès).
- Collections : `caisses_sessions` (une par ouverture/clôture), `caisse_mouvements` (dépenses, recettes, et les deux jambes d'un versement).
- Champs principaux : `CaisseSession.{soldeInitial, totalVente, totalDepense, totalRecette, totalVersementSorti, totalVersementRecu}` ; le solde théorique est `soldeInitial + totalVente + totalRecette + totalVersementRecu − totalDepense − totalVersementSorti`.

**3. Flux et interactions**
- **Reçoit** : le crédit de vente depuis Vente (`addCaisseVenteAmount`), déclenché à chaque ticket validé.
- **Alimente** : `sumCaisseDepensesRecettes` (et sa variante par caisse) sert au Compte de résultat et au Tableau de bord — les versements en sont explicitement exclus pour ne jamais compter comme charge ou produit un simple déplacement d'argent entre tiroirs.
- **Versement** : opération à deux écritures liées par un `transfertId`, avec rollback si l'une des deux caisses se ferme entre-temps.

**4. Analyse technique**
- Modèle propre (`caisse-model.ts` pur, sans Mongo, partagé client/serveur pour que les règles d'accès soient identiques des deux côtés).
- Un seul défaut de disposition trouvé et corrigé cette session (un panneau se retrouvait seul sur sa ligne, laissant un vide) — rien d'ouvert à ce jour.
- Migration prévue (`scripts/migrate-caisses.mjs`) pour les sessions antérieures au modèle à trois caisses, **non appliquée** — le code lit ces anciennes sessions correctement malgré tout (repli sur `site` si `caisse` est absent), donc ce n'est pas bloquant.

**5. Analyse fonctionnelle détaillée**
- **Affiché** : solde théorique, fond de caisse, ventes, dépenses, autres recettes, versements reçus/sortis, journal de session, historique des sessions passées.
- **Calculs** : solde théorique, écart à la clôture (`soldePhysique − théorique`).
- **Filtres** : date, caisse (si plusieurs accessibles).
- **Exports** : aucun export Excel sur cette page.
- **Limitation observée** : pas d'export — c'est la seule des 7 pages du Quotidien sans bouton Excel.

---

### B.3 Zogbo (`/zogbo`, `zogbo-page.tsx`, 946 lignes)

**1. Fonction de la page**
Écran de production : suivi du stock des plats (préparé, envoyé vers Gbégamey, vendu, stock actuel), des accompagnements sur place, des boissons, et un journal de ventes en lecture seule. C'est la seule des deux zones à préparer physiquement les plats de base.

**2. Données utilisées**
- Source : `GET /api/zogbo` (jour composé : lignes plats + `accompanimentLines` + CA journal + dernière date vendue + résumé des ventes).
- Collections : `zogbo_jours` (lignes plats et, depuis peu, lignes d'accompagnements propres à Zogbo), `parametres` (catalogue), `ventes_log` (résumé du jour par nature/source).
- Écriture : `POST /api/zogbo` (préparer/envoyer, annuler un mouvement) ; `PUT /api/zogbo` (enregistrer le comptage et les notes).

**3. Flux et interactions**
- **Vers Gbégamey** : chaque « Envoyer » incrémente `sentByProductId`, que Gbégamey lit ensuite comme son propre « reçu » (`getGbegameyDayPayload`) — c'est le seul canal de synchronisation entre les deux zones, purement déclaratif (aucune validation croisée automatique ; c'est à ça que sert la page Contrôle, en lecture seule).
- **Vers Vente** : le stock exposé au POS Zogbo vient de `zogbo_jours.lines`.
- **Depuis Pertes** : une perte déclarée sur un plat Zogbo décrémente directement `zogbo_jours`.

**4. Analyse technique**
- Le fichier a grossi avec l'ajout récent de l'onglet Accompagnements et du panneau Ventes — toujours un seul fichier, structure par onglets (`TabKey`) similaire à Gbégamey.
- **Fait notable** : `zogbo-page.tsx` importe `computeLocalLine` depuis `gbegamey-calc.ts` pour calculer ses propres accompagnements — la logique de calcul des accompagnements n'existe qu'à un seul endroit (bon signe), mais son nom de fichier ne le laisse pas deviner (mauvais signe pour la lisibilité).
- L'onglet Combos et son composant (`ZoneCombosPanel`) ont été retirés de cette page pendant la session (en parallèle de mes propres modifications) — voir §D.1, c'est le point le plus important du diagnostic.

**5. Analyse fonctionnelle détaillée**
- **Affiché** : 4 onglets — Plats, Accompagnements, Boissons, Ventes (journal du jour par nature et par source).
- **Calculs** : stock disponible (compté si saisi, sinon préparé − envoyé), stock actuel théorique (disponible − vendu).
- **Filtres** : date uniquement (pas de filtre produit).
- **Exports** : Excel (`exportZogboExcel`).
- **Incohérence observée** : `parseTab` fait passer `?tab=combos` sur l'onglet Accompagnements sans aucun message — un lien externe encore actif vers cette URL atterrit silencieusement au mauvais endroit plutôt que sur une erreur explicite.

---

### B.4 Gbégamey (`/gbegamey`, `gbegamey-page.tsx`, ~650 lignes)

**1. Fonction de la page**
Écran de réception : suivi des plats reçus de Zogbo (comparaison envoyé/reçu réel, écart de transport), des accompagnements préparés sur place, et des boissons. Contrairement à Zogbo, Gbégamey ne « prépare » pas de plats de base — elle les reçoit.

**2. Données utilisées**
- Source : `GET /api/gbegamey` (transferLines, localLines, sentByProductId, CA journal).
- Collections : `gbegamey_jours`, `parametres`, `ventes_log`.
- Écriture : `PUT /api/gbegamey` (comptage et notes des deux tableaux).

**3. Flux et interactions**
- **Depuis Zogbo** : `sentByProductId` alimente la colonne « Reçu » — voir §C.4 pour le détail du mécanisme de synchronisation.
- **Vers Vente** : stock exposé au POS Gbégamey = `gbegamey_jours.transferLines` (plats) + `localLines` (accompagnements).
- **Correction de cette session** : le stock d'un accompagnement jamais compté renvoyait `0` (vente bloquée) à Gbégamey contre `null` (vente libre) à Zogbo pour la même situation — comportement maintenant identique aux deux zones (fonction partagée `accompanimentAvailability`).

**4. Analyse technique**
- Structure proche de Zogbo (mêmes onglets Plats/Accompagnements/Boissons) mais **pas d'onglet Ventes-journal** — asymétrie avec Zogbo qui en a un. Pas de raison fonctionnelle identifiée à cette différence.
- L'onglet Combos a été retiré cette session (demande explicite, gardé côté Zogbo à l'origine — lui-même retiré depuis en parallèle, voir B.3).

**5. Analyse fonctionnelle détaillée**
- **Affiché** : 3 onglets — Reçu de Zogbo, Sur place, Boissons.
- **Calculs** : écart de transport (envoyé − reçu réel), stock actuel (solde − vendu).
- **Filtres** : date uniquement.
- **Exports** : Excel (`exportGbegameyExcel`).
- **Limitation observée** : pas de journal de ventes en propre (contrairement à Zogbo) — pour voir le détail des ventes Gbégamey, il faut aller sur Historique des ventes ou le Tableau de bord.

---

### B.5 Achats (`/appro`, menu « Achats », `achats-page.tsx`, 754 lignes)

**1. Fonction de la page**
Fusion, réalisée avant cette session, de deux anciennes pages : **Appro** (achats de stock matières) et **Matières** (comptage/seuils). Deux onglets aujourd'hui : **Dépenses** (mouvement de caisse avec explication libre — gaz, transport, électricité…) et **Stock** (achat d'une matière première avec fournisseur, quantité, prix).

*(Note : l'onglet Matières — comptage, seuils d'alerte, observations — a été retiré pendant cette session à la demande explicite de l'utilisateur ; l'historique de cette décision est dans le fil de conversation, pas dans ce rapport.)*

**2. Données utilisées**
- Source : `GET /api/achats` (dépenses de la caisse de zone) et `GET /api/matieres` (stock matières du jour).
- Collections : `caisses_sessions`/`caisse_mouvements` (onglet Dépenses), `matieres_jours` (onglet Stock).
- Écriture : `POST /api/achats` (dépense caisse), `POST /api/matieres` (achat, annulation).

**3. Flux et interactions**
- **Onglet Dépenses → Caisse** : chaque dépense saisie ici est un `CaisseMouvement` de type `depense`, strictement identique à un mouvement créé depuis l'écran Caisse lui-même — **ce sont la même donnée, saisie depuis deux écrans différents**.
- **Onglet Stock → Compte de résultat** : le total réel des achats matières du jour est maintenant lisible par `sumMatieresPurchasesForDate` (ajouté cette session) et suggéré — pas imposé — sur la ligne « Achats matières premières » du Compte de résultat.
- **Vers Pertes** : le stock matières affiché dans Pertes (famille « Matières ») vient de `computeMatieresDay`, la même fonction que celle utilisée ici.

**4. Analyse technique**
- Le fichier porte encore les noms de ses deux pages d'origine en commentaire (« ancienne page Appro », « ancienne page Matières ») — utile pour comprendre l'historique, à nettoyer si la fusion est définitivement validée.
- Deep-link `?tab=matieres` encore lu par un `useEffect` alors que l'onglet correspondant n'existe plus — mort depuis le retrait de l'onglet (même symptôme que Zogbo/Combos, voir §D.1).

**5. Analyse fonctionnelle détaillée**
- **Affiché** : formulaire de dépense + liste des dépenses du jour (onglet Dépenses) ; tableau stock matières + formulaire d'achat + registre annulable (onglet Stock).
- **Calculs** : total des dépenses du jour par caisse.
- **Filtres** : date, caisse (si plusieurs accessibles).
- **Exports** : Excel, différent par onglet (`achats-stock` vs `achats`).
- **Doublon observé** : la nature d'une dépense « Achats matières » peut être saisie ici en texte libre (onglet Dépenses, ex. « achat riz ») **ou** de façon structurée dans l'onglet Stock (produit, quantité, prix) **ou** encore recopiée à la main dans le Compte de résultat — trois façons d'enregistrer le même fait, avec des degrés de précision différents et aucun garde-fou empêchant de le faire deux fois.

---

### B.6 Pertes (`/pertes`, `pertes-page.tsx`, 401 lignes)

**1. Fonction de la page**
Déclaration d'une sortie de stock qui n'est pas une vente — gâté, casse, test — avec motif obligatoire. Couvre quatre familles : plats, sur place (accompagnements, absent à Zogbo), boissons, matières.

**2. Données utilisées**
- Source : `GET /api/pertes` (journal du jour), `GET /api/vente` (candidats plats/accompagnements/boissons avec leur stock), `GET /api/matieres` (candidats matières).
- Collections : `pertes` (nouvelle collection dédiée), plus la reprise de stock sur `zogbo_jours`/`gbegamey_jours`/`boissons_jours`/`matieres_jours` selon la famille.
- Écriture : `POST /api/pertes` (déclarer, annuler).

**3. Flux et interactions**
- **Vers le stock** : `recordPerte` décrémente directement la ligne concernée (même mécanisme que `applySoldDelta` utilisé par les ventes) ; annuler une perte reprend le stock.
- **Coût** : chaque perte porte un `cost` (prix de revient × quantité), sommé en tête de journal — c'est la seule des 7 pages à afficher un coût de revient plutôt qu'un prix de vente.
- **Dépend de Vente et Achats** pour connaître le stock actuel de chaque produit avant de proposer une déclaration.

**4. Analyse technique**
- Page la plus courte des sept, bien délimitée, aucun sous-composant nécessaire.
- Réutilise `computeMatieresDay` (même fonction qu'Achats) pour les candidats matières — bon exemple de partage sans duplication.
- `FAMILLES.filter((f) => !(f.key === "local" && site === "zogbo"))` masque la famille « Sur place » à Zogbo, cohérent avec l'absence d'onglet « Sur place » propre à Zogbo… sauf que Zogbo **a** maintenant ses propres accompagnements (`accompanimentLines`, voir B.3) : cette exclusion semble datée par rapport à l'évolution récente de Zogbo, à vérifier.

**5. Analyse fonctionnelle détaillée**
- **Affiché** : formulaire de déclaration, journal du jour avec coût total.
- **Calculs** : coût de la perte (prix de revient × quantité), coût total du jour.
- **Filtres** : date, site, famille de produit.
- **Exports** : aucun export Excel sur cette page.
- **Limitation observée** : comme Caisse, pas de bouton Excel — à mettre en regard si l'export devient un standard attendu sur toutes les pages du Quotidien.

---

## C. Flux transversaux (vue d'ensemble demandée en partie 3)

### C.1 Impact d'une vente sur la caisse
Immédiat et atomique : `validatePosTicket` écrit les lignes de vente, crée le ticket, **puis** crédite la caisse dans la même fonction ; si le crédit échoue, les lignes déjà écrites sont reprises (rollback). Il n'existe qu'un seul chemin d'encaissement depuis le retrait du mode Rapide cette session — avant cela, des ventes pouvaient exister sans jamais toucher la caisse, ce qui expliquait des écarts CA/caisse observés en tout début de session.

### C.2 Impact des achats sur les statistiques
Partiel. L'onglet Dépenses d'Achats alimente immédiatement le Compte de résultat via les dépenses de caisse (catégorie « indicative », hors résultat). L'onglet Stock alimente le stock matières, dont le total du jour est désormais *suggéré* (pas injecté automatiquement) dans la charge « Achats matières premières » du résultat — un geste manuel reste nécessaire pour que ce soit compté dans le résultat d'exploitation.

### C.3 Gestion des pertes
Une perte est une sortie de stock avec motif, jamais une vente : elle ne touche jamais `ventes_log` ni la caisse, seulement le compteur de stock du produit concerné et son propre journal `pertes`. Elle apparaît dans le Compte de résultat comme charge séparée (« Pertes déclarées »), calculée automatiquement (jamais saisie à la main, contrairement aux autres charges).

### C.4 Synchronisation entre Zogbo et Gbégamey
Un seul canal, à sens unique et déclaratif : le bouton « Envoyer » de Zogbo. Il n'y a **aucune validation automatique** que la quantité reçue à Gbégamey corresponde à la quantité envoyée — Gbégamey peut saisir un « Reçu réel » différent, l'écart est affiché (`transportVariance`) mais rien ne bloque ni n'alerte au-delà d'un badge visuel sur la ligne. La page Contrôle existe précisément pour repérer ces écarts a posteriori, en lecture seule.

---

## D. Diagnostic

### D.1 Faiblesse majeure : les Combos sont un angle mort actif

Ce n'est pas un doublon à fusionner — c'est une fonctionnalité à moitié retirée :
- `ZoneCombosPanel` (le composant qui affichait/gérait les combos) **a été supprimé du dépôt**.
- Ni Zogbo ni Gbégamey n'ont plus d'onglet Combos.
- `/combos` redirige vers `/zogbo?tab=combos`, qui affiche désormais silencieusement l'onglet Accompagnements.
- `/api/combos` et la collection `combos_jours` existent toujours et continuent d'être lus par `synthese-repo.ts` pour calculer `caCombos`, affiché sur le Tableau de bord et le Compte de résultat.

**Conséquence concrète** : le chiffre « CA combos » que tout gérant voit chaque jour est figé à ce qu'il valait la dernière fois que quelqu'un a pu saisir un combo — personne ne peut plus le faire évoluer depuis l'interface. Si des combos se vendent encore dans la réalité, ils ne sont enregistrés nulle part et le CA réel est sous-évalué sans qu'aucun signal ne le montre.

### D.2 Doublon confirmé : accompagnements Zogbo / Gbégamey

Même type de données (`GbegameyLocalLine`), même fonction de calcul (`computeLocalLine`), deux tableaux et deux formulaires distincts. Jusqu'à cette session, le comportement de stock différait aussi (Gbégamey bloquait la vente à tort) — corrigé, mais la duplication du code d'affichage demeure.

### D.3 Doublon confirmé : saisie d'une dépense « achats matières »

Trois emplacements pour le même fait (§B.5.5) : mouvement de caisse en texte libre, achat structuré dans l'onglet Stock, ou charge manuelle du Compte de résultat. Rien n'empêche de saisir la même dépense deux fois.

### D.4 Incohérences mineures relevées

- Deep-links morts vers des onglets retirés (`?tab=combos` sur Zogbo, `?tab=matieres` sur Achats) — silencieux, pas d'erreur, juste le mauvais onglet.
- Gbégamey n'a pas de journal de ventes propre alors que Zogbo en a un.
- Caisse et Pertes n'ont pas de bouton d'export Excel, contrairement aux cinq autres pages du Quotidien.
- Pertes masque la famille « Sur place » à Zogbo alors que Zogbo gère maintenant ses propres accompagnements.

### D.5 Forces de l'architecture actuelle

- Couplage exclusivement par API/Mongo entre les 7 pages — aucune ne dépend du code interne d'une autre, ce qui rend une fusion ou un découpage technique peu risqué en soi.
- Le modèle de caisse (coffre + zones, versements neutres) est cohérent et déjà bien intégré partout où l'argent circule.
- Les pertes et les ventes partagent le même mécanisme atomique de mouvement de stock (`applySoldDelta`), pas de logique dupliquée à ce niveau précis.
- La fusion Appro+Matières déjà réalisée montre que le motif de fusion qui fonctionne est « même donnée sous-jacente », pas « même famille métier vague ».

### D.6 Données qui pourraient être centralisées

- Le calcul de disponibilité d'un accompagnement (`accompanimentAvailability`) est déjà centralisé dans `vente-repo.ts` — seul l'**affichage** (deux tableaux séparés dans deux pages) ne l'est pas.
- La saisie d'une dépense d'exploitation (nature, montant) pourrait n'avoir qu'un seul point d'entrée, la page Caisse, avec Achats qui n'en serait qu'un raccourci contextuel plutôt qu'un chemin d'écriture parallèle.

---

## E. Recommandations

**Ce qui doit être conservé tel quel :**
- La séparation Vente / Caisse / Zogbo / Gbégamey / Pertes en pages distinctes — chacune correspond à un moment et un lieu différents du service, avec des utilisateurs et des droits différents. Rien dans l'analyse ne justifie de les fusionner entre elles.
- Le mécanisme d'atomicité vente→caisse et perte→stock.

**Ce qui peut être fusionné (candidats, à valider avec vous avant toute exécution) :**
- L'affichage des accompagnements Zogbo/Gbégamey pourrait devenir un seul composant paramétré par site (comme `ZoneBoissonsPanel` l'est déjà), sans changer la donnée ni fusionner les pages elles-mêmes.
- La saisie d'une dépense pourrait être unifiée : un seul formulaire (celui de Caisse), Achats devenant une vue filtrée plutôt qu'une seconde voie d'écriture.

**Ce qui doit être amélioré, indépendamment de toute fusion :**
- Trancher le sort des Combos : soit rétablir un point de saisie (même minimal), soit retirer proprement `/api/combos`, `combos_jours` et `caCombos` des rapports, pour ne pas laisser un chiffre invérifiable dans le Compte de résultat.
- Nettoyer les deep-links morts (`?tab=combos`, `?tab=matieres`) ou les rediriger explicitement.
- Harmoniser les exports Excel (Caisse et Pertes en sont dépourvues) et la présence d'un journal de ventes (absent de Gbégamey).
- Revoir l'exclusion de la famille « Sur place » à Zogbo dans Pertes, potentiellement obsolète.

**Impacts sur les utilisateurs et les données, à anticiper avant toute exécution :**
- Une fusion d'affichage (accompagnements) est invisible pour l'utilisateur final si elle est bien faite — aucun impact formation.
- Une fusion du point d'entrée des dépenses changerait une habitude déjà prise par les gérants sur Achats → Dépenses ; à accompagner d'un message ou d'un temps de transition.
- Trancher les Combos a un impact direct sur des chiffres déjà publiés (CA historique) : si la donnée est retirée des rapports, les totaux passés changeront rétroactivement à l'écran — à décider consciemment, pas en silence.

---

*Rapport préparé sans aucune modification de code, de page ou de donnée. Toute action décrite en partie E reste à valider explicitement avant exécution.*
