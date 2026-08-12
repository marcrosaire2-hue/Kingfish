export type GuideSlug =
  | "demarrage"
  | "vente"
  | "caisse"
  | "appro"
  | "matieres"
  | "reglages"
  | "parametres"
  | "zogbo"
  | "gbegamey"
  | "synthese"
  | "compte-resultat"
  | "historique"
  | "historique-ventes"
  | "equipes"
  | "admin";

export type GuideStep = {
  title: string;
  body: string;
};

export type Guide = {
  slug: GuideSlug;
  title: string;
  space: string;
  href: string;
  summary: string;
  steps: GuideStep[];
  tips?: string[];
};

export const GUIDES: Guide[] = [
  {
    slug: "demarrage",
    title: "Démarrage",
    space: "Vue d’ensemble",
    href: "/",
    summary:
      "King Fish Manager : deux points (Zogbo et Gbégamey) et l’ordre recommandé pour démarrer.",
    steps: [
      {
        title: "Deux points, un seul système",
        body: "Dans King Fish Manager, Zogbo est le centre de production. Gbégamey est un point de vente qui reçoit une partie du stock depuis Zogbo et prépare aussi des plats sur place. Chaque point a son propre chiffre d’affaires (plats + combos + boissons).",
      },
      {
        title: "Configurer avant de vendre",
        body: "Allez dans Paramètres (rôle admin). Choisissez le point Zogbo ou Gbégamey, puis renseignez les listes et les prix. Sans prix corrects, les montants et la vente rapide seront faux.",
      },
      {
        title: "Saisir la production du jour à Zogbo",
        body: "Dans Zogbo → Plats : la colonne Stock montre ce que vous avez. Ajoutez des préparations ou des envois via les champs (ils se vident après) ; chaque mouvement est tracé dans le registre en bas. Les ventes passent par la page Vente.",
      },
      {
        title: "Suivre Gbégamey",
        body: "Dans Gbégamey → Reçu de Zogbo : solde et reçu sont automatiques. Après une vente, le stock actuel baisse tout seul (solde − vendu). Compté sert au contrôle physique.",
      },
      {
        title: "Enregistrer les ventes au fil de l’eau",
        body: "La page Vente permet d’ajouter ou retirer une vente (+1 / −1) par produit et par site. C’est le seul endroit où l’on saisit les ventes : les colonnes « Vendu » des inventaires se mettent à jour automatiquement.",
      },
      {
        title: "Contrôler le résultat",
        body: "Le Tableau de bord (page d’accueil) montre le CA Zogbo / Gbégamey, le mix, les charges et le résultat avec des graphiques. Utilisez Jour / Mois / Année.",
      },
    ],
    tips: [
      "Choisissez toujours la bonne date avant de saisir.",
      "Cliquez sur Enregistrer après chaque saisie importante.",
      "Les combos et boissons se gèrent sous chaque point (Zogbo / Gbégamey), pas dans un menu séparé.",
    ],
  },
  {
    slug: "vente",
    title: "Guide Vente / POS",
    space: "Vente",
    href: "/vente",
    summary:
      "Mode POS (panier multi-lignes + ticket) ou Mode rapide (+1 / −1). Les inventaires se mettent à jour automatiquement.",
    steps: [
      {
        title: "Ouvrir la caisse (Gbégamey)",
        body: "Avant de valider un ticket POS à Gbégamey, ouvrez une session sur la page Caisse. Une bannière vous y renvoie si besoin.",
      },
      {
        title: "Mode POS",
        body: "Ajoutez des produits au panier, choisissez le type de vente (Sur place ou Rapido), le paiement, éventuellement table / serveur / client / réduction, puis Créer commande.",
      },
      {
        title: "Mode rapide",
        body: "Basculez en Mode rapide pour le comportement +1 / −1 par produit, comme avant.",
      },
      {
        title: "Choisir le site",
        body: "En haut de la page, sélectionnez Zogbo ou Gbégamey. Si votre compte est limité à un site, l’autre bouton est désactivé.",
      },
      {
        title: "Vérifier la date",
        body: "La date doit correspondre au jour de service. Les ventes s’appliquent uniquement à ce jour et à ce site.",
      },
      {
        title: "Choisir la catégorie",
        body: "Onglets Plats, Combos, Boissons (et Sur place à Gbégamey). Seuls les produits du catalogue Paramètres apparaissent.",
      },
      {
        title: "Ajouter une vente",
        body: "Cliquez sur +1 pour chaque unité vendue. Pour une vente hors catalogue, onglet Extra : description + prix FCFA. Le CA du site se met à jour.",
      },
      {
        title: "Corriger une erreur",
        body: "Utilisez −1 sur le produit, ou Annuler dans le journal pour la dernière opération. Le stock inventaire du jour est recalculé.",
      },
      {
        title: "Boissons sans prix",
        body: "Si une boisson n’a pas de prix de vente dans Paramètres, le bouton est bloqué. Corrigez d’abord le prix, puis vendez.",
      },
      {
        title: "Historique des ventes",
        body: "Le journal du jour montre les dernières lignes. Pour tous les tickets (filtres date, site, statut, serveur, paiement), ouvrez Historique ventes.",
      },
    ],
    tips: [
      "Préférez la page Vente pendant le service ; l’inventaire sert surtout au contrôle et aux écarts.",
      "Le CA du jour compte uniquement les ventes Validé (comme AquaPro).",
      "Les ventes combos / boissons sont comptées dans le point du site choisi.",
    ],
  },
  {
    slug: "parametres",
    title: "Guide Paramètres",
    space: "Paramètres",
    href: "/parametres",
    summary:
      "Gérer les catalogues et les prix, classés par point Zogbo et Gbégamey.",
    steps: [
      {
        title: "Choisir le point",
        body: "Onglet Zogbo ou Gbégamey en premier. Tout le catalogue est rangé sous l’un des deux points.",
      },
      {
        title: "Zogbo → Plats de base",
        body: "Liste des plats produits à Zogbo. Le prix unitaire sert aussi aux ventes de plats reçus à Gbégamey.",
      },
      {
        title: "Zogbo / Gbégamey → Combos",
        body: "Catalogue partagé : nom, prix, plat de base (info). Les combos se préparent à Zogbo et s’envoient à Gbégamey ; le stock est propre au combo.",
      },
      {
        title: "Zogbo / Gbégamey → Boissons",
        body: "Catalogue partagé : prix d’achat et prix de vente. Le stock est commun ; seules les quantités vendues sont séparées par zone.",
      },
      {
        title: "Gbégamey → Plats sur place",
        body: "Plats ou accompagnements préparés uniquement à Gbégamey, hors envois depuis Zogbo.",
      },
      {
        title: "Enregistrer",
        body: "Toute modification reste locale jusqu’à Enregistrer. Réinitialiser remet les listes d’origine (confirmation demandée).",
      },
    ],
    tips: [
      "Complétez toujours le prix de vente des boissons.",
      "Renommer un plat de base peut impacter le lien des combos : vérifiez la colonne « Plat de base à déduire ».",
    ],
  },
  {
    slug: "zogbo",
    title: "Guide Zogbo",
    space: "Zogbo",
    href: "/zogbo",
    summary:
      "Point Zogbo : production, envois, ventes plats, combos et boissons du site.",
    steps: [
      {
        title: "Sélectionner le jour",
        body: "Utilisez le champ date en haut. Chaque jour a son inventaire. Si des modifications ne sont pas enregistrées, un message demande confirmation avant de changer de jour.",
      },
      {
        title: "Onglet Plats",
        body: "Colonne Dispo = préparé − envoyé. Stock actuel = dispo − ventes (libéré auto à chaque vente). Compté = contrôle physique. Préparé / Envoyer via les champs + registre en bas.",
      },
      {
        title: "Enregistrer les plats",
        body: "Le bouton Enregistrer (en-tête) sauvegarde l’inventaire plats. Les envois alimentent automatiquement la colonne Reçu de Gbégamey pour le même jour.",
      },
      {
        title: "Onglet Combos",
        body: "Préparer à Zogbo (+ Préparé), envoyer à Gbégamey (→), vendre via Vente. Stock actuel = dispo − ventes. Registre des mouvements en bas.",
      },
      {
        title: "Onglet Boissons",
        body: "Stock et achats en casiers (+ Achat). Ventes à la bouteille via Vente. Le stock actuel convertit automatiquement (bt / casier dans Paramètres).",
      },
      {
        title: "Contrôler le point",
        body: "Le chiffre d’affaires du point Zogbo = plats + combos + boissons vendus ici. Il apparaît séparé de Gbégamey dans la Synthèse.",
      },
    ],
    tips: [
      "N’envoyez pas plus que ce qui a été préparé (la ligne passe en alerte).",
      "Cuisine peut se concentrer sur Préparé / Envoyé ; les ventes peuvent passer par la page Vente.",
    ],
  },
  {
    slug: "gbegamey",
    title: "Guide Gbégamey",
    space: "Gbégamey",
    href: "/gbegamey",
    summary:
      "Point Gbégamey : stock reçu, plats sur place, combos et boissons du site.",
    steps: [
      {
        title: "Sélectionner le jour",
        body: "Même date que le service. Le reçu dépend des envois saisis à Zogbo pour ce jour.",
      },
      {
        title: "Onglet Reçu de Zogbo",
        body: "Solde initial = reste veille (auto). Reçu Zogbo = envois du jour (auto). Solde = initial + reçu. Après une vente, Stock actuel = solde − vendu (libéré auto). Compté = contrôle physique optionnel.",
      },
      {
        title: "Onglet Sur place",
        body: "Stock initial automatique (reste veille). Indiquez Préparé. Stock actuel = dispo − ventes (auto). Compté = contrôle physique optionnel.",
      },
      {
        title: "Enregistrer plats",
        body: "Le bouton Enregistrer de l’en-tête sauvegarde reçu + sur place. Passez ensuite aux combos / boissons si besoin.",
      },
      {
        title: "Onglets Combos et Boissons",
        body: "Combos : préparés à Zogbo, reçus auto à Gbégamey, vendus via Vente. Boissons : achats en casiers (+ Achat) et ventes à la bouteille via Vente.",
      },
      {
        title: "Point Gbégamey",
        body: "CA du point = plats (reçu + sur place) + combos + boissons vendus ici. Indépendant du point Zogbo.",
      },
    ],
    tips: [
      "Si Reçu est à 0, vérifiez d’abord les envois du même jour dans Zogbo.",
      "Utilisez la page Vente (site Gbégamey) pendant le service pour aller plus vite.",
    ],
  },
  {
    slug: "synthese",
    title: "Guide Tableau de bord",
    space: "Tableau de bord",
    href: "/",
    summary:
      "Vue d’ensemble avec graphiques : CA par point, mix, charges et résultat en FCFA (jour, mois, année).",
    steps: [
      {
        title: "Choisir la période",
        body: "Onglets Jour, Mois ou Année. Ajustez la date, le mois ou l’année selon la vue.",
      },
      {
        title: "Lire les KPI et graphiques",
        body: "Cartes CA Zogbo / Gbégamey / total, donuts de mix, barres et courbes d’évolution. Tous les montants sont en FCFA.",
      },
      {
        title: "Saisir les charges",
        body: "Dans la vue Jour, remplissez les postes de charges. Le résultat = CA − charges. Enregistrez.",
      },
      {
        title: "Vue mois / année",
        body: "Courbes et histogrammes jour par jour ou mois par mois. Cliquez Voir pour ouvrir le détail.",
      },
    ],
    tips: [
      "Sans vente un jour donné, les graphiques restent à zéro.",
      "Marge boissons = (PV − PA) × quantités vendues (tous sites).",
    ],
  },
  {
    slug: "historique-ventes",
    title: "Guide Historique ventes",
    space: "Historique ventes",
    href: "/historique-ventes",
    summary:
      "Tous les tickets King Fish et AquaPro : filtres période, site, statut, source, serveur, paiement et recherche.",
    steps: [
      {
        title: "Choisir la période",
        body: "Du / Au (par défaut : début du mois → aujourd’hui). Les totaux se recalculent à chaque changement de filtre.",
      },
      {
        title: "Filtrer le CA",
        body: "Par défaut Statut = Validé (comme AquaPro). Passez à Tous / Annulé / En cours pour l’audit. Le montant affiché ne compte que les tickets Validé.",
      },
      {
        title: "Site, source, serveur, paiement",
        body: "Isolez Zogbo ou Gbégamey, King Fish ou AquaPro, un serveur ou un mode de paiement. Les listes Serveur / Paiement viennent des tickets de la période.",
      },
      {
        title: "Recherche et détail",
        body: "Recherchez un n° de ticket, un client ou un produit. Cliquez Lignes pour voir le détail du ticket.",
      },
    ],
    tips: [
      "Accessible aussi depuis la page Vente (lien Historique ventes).",
      "Le Registre (autre menu) trace l’activité système ; ici ce sont les tickets de vente.",
    ],
  },
  {
    slug: "equipes",
    title: "Guide Répartition équipes",
    space: "Équipes",
    href: "/equipes",
    summary:
      "CA équipe de jour contre équipe de nuit sur une période — jour par jour, avec totaux et export Excel.",
    steps: [
      {
        title: "Choisir la période",
        body: "Du / Au, ou raccourcis Cette semaine, Semaine dernière, Ce mois. Par défaut : début du mois → aujourd’hui.",
      },
      {
        title: "Filtrer par site",
        body: "Tous les sites, Zogbo ou Gbégamey. Les comptes rattachés à une zone voient uniquement leur site.",
      },
      {
        title: "Lire le tableau",
        body: "Une ligne par jour : CA jour, CA nuit, total et pourcentages. Les jours sans vente apparaissent en grisé.",
      },
      {
        title: "Exporter",
        body: "Excel avec feuilles Jours (détail) et Synthèse (totaux période). Même source que l’écran Vente.",
      },
    ],
    tips: [
      "L’équipe est celle du compte vendeur au moment de la vente, pas celle saisie sur le ticket.",
      "Les ventes antérieures aux équipes sont regroupées sous Hors équipe.",
    ],
  },
  {
    slug: "historique",
    title: "Guide Registre",
    space: "Registre",
    href: "/historique",
    summary:
      "Registre de tous les mouvements : ventes, transferts, inventaires, paramètres, charges et comptes.",
    steps: [
      {
        title: "Ouvrir la période",
        body: "Choisissez Du / Au (par défaut : début du mois → aujourd’hui). Cliquez Actualiser si besoin.",
      },
      {
        title: "Filtrer par type",
        body: "Ventes, annulations, Zogbo, Gbégamey, combos, boissons, paramètres, charges ou utilisateurs.",
      },
      {
        title: "Filtrer par site",
        body: "Zogbo, Gbégamey ou tous les sites pour isoler un point.",
      },
      {
        title: "Lire une ligne",
        body: "Chaque événement indique l’heure, le type, le site, le jour de service, le détail, l’auteur (si connu) et un montant le cas échéant.",
      },
      {
        title: "Ce qui est tracé",
        body: "Ventes (page Vente), enregistrements d’inventaire, combos/boissons, paramètres, charges de synthèse, création/modification de comptes, annulations de vente.",
      },
    ],
    tips: [
      "Pour les tickets de vente, utilisez Historique ventes.",
      "Réservé au gérant et à l’administrateur.",
    ],
  },
  {
    slug: "caisse",
    title: "Guide Caisse",
    space: "Caisse",
    href: "/caisse",
    summary:
      "Ouvrir et fermer la caisse, enregistrer dépenses / recettes, contrôler l’écart.",
    steps: [
      {
        title: "Ouvrir la session",
        body: "Choisissez le site et la date, saisissez le solde initial (fond de caisse), puis ouvrez. Une seule caisse ouverte par utilisateur et par site.",
      },
      {
        title: "Pendant le service",
        body: "Les tickets POS validés alimentent le total ventes. Ajoutez des dépenses ou autres recettes depuis le détail de session.",
      },
      {
        title: "Fermer",
        body: "Saisissez le solde physique compté, un commentaire si besoin, puis fermez. L’écart = physique − théorique (initial + ventes + recettes − dépenses).",
      },
    ],
    tips: [
      "Gbégamey : ouvrez la caisse avant de valider des tickets POS.",
      "Consultez l’historique pour reprendre une session fermée en lecture.",
    ],
  },
  {
    slug: "appro",
    title: "Guide Appro",
    space: "Appro",
    href: "/appro",
    summary:
      "Enregistrer les entrées de matières premières (achats), annulables comme les achats boissons.",
    steps: [
      {
        title: "Choisir le jour",
        body: "Sélectionnez la date du jour d’approvisionnement.",
      },
      {
        title: "Saisir un achat",
        body: "Pour chaque matière, indiquez la quantité reçue puis validez. Le mouvement apparaît dans le registre et augmente le stock.",
      },
      {
        title: "Annuler une erreur",
        body: "Annulez un mouvement du registre pour remettre le stock comme avant (le mouvement reste barré).",
      },
    ],
  },
  {
    slug: "matieres",
    title: "Guide Matières",
    space: "Matières",
    href: "/matieres",
    summary:
      "Suivre le stock matières, le comptage physique et les alertes de seuil.",
    steps: [
      {
        title: "Lire le stock",
        body: "Stock = stock initial + achats − consommations. Le report du jour précédent sert d’ouverture.",
      },
      {
        title: "Comptage",
        body: "Saisissez le compté physique puis Enregistrer. Ce chiffre sert de report pour le lendemain.",
      },
      {
        title: "Seuils",
        body: "Les matières sous le seuil (défini dans Paramètres) apparaissent en alerte « au seuil ».",
      },
    ],
  },
  {
    slug: "reglages",
    title: "Guide Réglages POS",
    space: "Réglages",
    href: "/reglages",
    summary:
      "Tables, moyens de paiement et fiche entreprise imprimés sur les tickets.",
    steps: [
      {
        title: "Tables et serveurs",
        body: "Ajoutez les tables (référence / emplacement) et les serveurs utilisés en mode Table sur la vente POS.",
      },
      {
        title: "Paiements",
        body: "Définissez les moyens (Cash, Mobile Money, etc.). Ils apparaissent au moment de valider un ticket.",
      },
      {
        title: "Entreprise",
        body: "Nom, contacts et adresse s’affichent en en-tête à l’impression du ticket navigateur.",
      },
    ],
  },
  {
    slug: "compte-resultat",
    title: "Guide Compte de résultat",
    space: "Compte de résultat",
    href: "/compte-resultat",
    summary:
      "Présentation comptable : produits (CA), charges d’exploitation et résultat, jour / mois / année.",
    steps: [
      {
        title: "Choisir la période",
        body: "Onglets Jour, Mois ou Année. Le CA vient des ventes ; les charges sont celles saisies pour chaque jour.",
      },
      {
        title: "Lire le compte",
        body: "I Produits (détail CA), II Charges, III Résultat = CA − charges. Les dépenses de caisse sont affichées à titre indicatif sans entrer dans le résultat.",
      },
      {
        title: "Saisir les charges (vue Jour)",
        body: "Renseignez matières, loyer, salaires, etc. puis Enregistrer charges. Ces montants alimentent aussi le tableau de bord.",
      },
    ],
    tips: [
      "Réservé au gérant et à l’administrateur.",
      "Exportez en Excel pour archivage ou contrôle.",
    ],
  },
  {
    slug: "admin",
    title: "Guide Admin",
    space: "Admin",
    href: "/admin",
    summary:
      "Créer et gérer les comptes : rôles, sites autorisés, activation.",
    steps: [
      {
        title: "Deux niveaux d’admin",
        body: "Admin de zone (site Zogbo ou Gbégamey) : gère uniquement sa zone. Administrateur global (Les deux sites) : aide toutes les zones et crée les admins de zone.",
      },
      {
        title: "Comprendre les autres rôles",
        body: "Vendeur : Vente + Caisse + historique ventes. Cuisine : inventaire du site, Appro, Matières. Gérant : ops + synthèse selon son site.",
      },
      {
        title: "Créer un admin de zone",
        body: "Rôle Administrateur + site Zogbo ou Gbégamey. Il ne verra que sa zone et ne pourra gérer que les comptes de cette zone.",
      },
      {
        title: "Créer l’aide multi-zones",
        body: "Rôle Administrateur + Les deux sites. Réservé à l’admin global (le compte « admin » par défaut).",
      },
      {
        title: "Création groupée",
        body: "Collez une ligne par compte : identifiant;nom;motdepasse;role;site. Ex. …;admin;zogbo pour un admin de zone.",
      },
    ],
    tips: [
      "Changez le mot de passe admin par défaut dès la mise en service.",
      "Donnez le rôle le plus restreint possible à chaque personne.",
      "Un admin de zone ne voit pas les comptes des autres zones.",
    ],
  },
];

const BY_SLUG = new Map(GUIDES.map((g) => [g.slug, g]));

export function getGuide(slug: string): Guide | undefined {
  return BY_SLUG.get(slug as GuideSlug);
}

export function guideSlugForPath(pathname: string): GuideSlug {
  if (pathname === "/" || pathname.startsWith("/synthese")) return "synthese";
  if (pathname.startsWith("/compte-resultat")) return "compte-resultat";
  if (pathname.startsWith("/vente")) return "vente";
  if (pathname.startsWith("/caisse")) return "caisse";
  if (pathname.startsWith("/appro")) return "appro";
  if (pathname.startsWith("/matieres")) return "matieres";
  if (pathname.startsWith("/reglages")) return "reglages";
  if (pathname.startsWith("/parametres")) return "parametres";
  if (pathname.startsWith("/zogbo")) return "zogbo";
  if (pathname.startsWith("/gbegamey")) return "gbegamey";
  if (pathname.startsWith("/historique-ventes")) return "historique-ventes";
  if (pathname.startsWith("/equipes")) return "equipes";
  if (pathname.startsWith("/historique")) return "historique";
  if (pathname.startsWith("/admin")) return "admin";
  if (pathname.startsWith("/guide")) return "demarrage";
  return "demarrage";
}

export function isGuideSlug(value: string): value is GuideSlug {
  return BY_SLUG.has(value as GuideSlug);
}
