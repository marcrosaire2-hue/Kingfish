import type { UserShift } from "@/lib/auth-types";

export type ProductId = string;

export type BaseDish = {
  id: ProductId;
  name: string;
  unitPrice: number;
  /** Prix de revient (optionnel) */
  costPrice?: number;
  /**
   * Seuil d’alerte : au-dessous, le produit est signalé à réapprovisionner
   * avant d’être en rupture. 0 ou absent = pas d’alerte.
   */
  alertThreshold?: number;
};

export type ComboDish = {
  id: ProductId;
  name: string;
  unitPrice: number;
  /** Nom du plat de base à déduire du stock, ou null si aucun */
  baseDishName: string | null;
  costPrice?: number;
  /**
   * Seuil d’alerte : au-dessous, le produit est signalé à réapprovisionner
   * avant d’être en rupture. 0 ou absent = pas d’alerte.
   */
  alertThreshold?: number;
};

export type Drink = {
  id: ProductId;
  name: string;
  /** Prix d’achat par bouteille */
  purchasePrice: number;
  /** Prix de vente par bouteille */
  salePrice: number | null;
  /**
   * Nombre de bouteilles par casier (unité de mesure du stock / des achats).
   * PB/PM ≈ 24, GB ≈ 12.
   */
  unitsPerCasier: number;
  /**
   * Seuil d’alerte en bouteilles : en dessous, la boisson est signalée comme
   * à réapprovisionner, avant d’être en rupture. 0 ou absent = pas d’alerte.
   */
  alertThreshold?: number;
};

export type LocalDish = {
  id: ProductId;
  name: string;
  unitPrice: number;
  costPrice?: number;
  /**
   * Seuil d’alerte : au-dessous, le produit est signalé à réapprovisionner
   * avant d’être en rupture. 0 ou absent = pas d’alerte.
   */
  alertThreshold?: number;
};

/** Matière première (aliment source) */
export type RawMaterial = {
  id: ProductId;
  name: string;
  unit: string;
  purchasePrice: number;
  threshold: number;
  stockBlocking: boolean;
};

/** Composition d’un produit vendable → matières */
export type RecipeLine = {
  rawMaterialId: ProductId;
  qty: number;
};

export type Recipe = {
  productId: ProductId;
  lines: RecipeLine[];
};

export type Parametres = {
  baseDishes: BaseDish[];
  combos: ComboDish[];
  drinks: Drink[];
  localDishes: LocalDish[];
  rawMaterials?: RawMaterial[];
  recipes?: Recipe[];
  updatedAt: string | null;
};

export type DayStatus = "ouverte" | "cloturee";

/**
 * Motif d'une sortie de stock qui n'est pas une vente. Le motif est
 * obligatoire : une quantité qui disparaît sans raison déclarée est
 * indiscernable d'un vol.
 */
export type PerteMotif =
  | "gate"
  | "casse"
  | "test"
  | "offert"
  | "erreur"
  | "autre";

export const PERTE_MOTIF_LABELS: Record<PerteMotif, string> = {
  gate: "Produit gâté / périmé",
  casse: "Casse",
  test: "Test / dégustation",
  offert: "Offert",
  erreur: "Erreur de préparation",
  autre: "Autre (à préciser)",
};

/** Famille de stock concernée par une perte. */
export type PerteKind = "plat" | "local" | "combo" | "boisson" | "matiere";

/** Une déclaration de perte au journal — jamais effacée, seulement annulable. */
export type PerteEntry = {
  id: string;
  date: string;
  site: VenteSite;
  kind: PerteKind;
  productId: ProductId;
  name: string;
  qty: number;
  motif: PerteMotif;
  commentaire: string;
  /** Prix de revient unitaire figé au moment de la déclaration */
  unitCost: number;
  /** qty × unitCost, ce que la perte coûte réellement */
  cost: number;
  at: string;
  cancelledAt: string | null;
  actorName: string | null;
  cancelledByName: string | null;
};

/** Mouvement de stock Zogbo (préparation ou envoi) */
export type ZogboMovementType = "prepare" | "send";

export type ZogboMovement = {
  id: string;
  at: string;
  type: ZogboMovementType;
  productId: ProductId;
  name: string;
  qty: number;
  /** Stock du plat après ce mouvement */
  stockAfter: number;
  /** Horodatage de l’annulation — le mouvement reste au registre, barré */
  cancelledAt: string | null;
};

/** Ligne inventaire Zogbo — stock = ce que j’ai maintenant */
export type ZogboLine = {
  productId: ProductId;
  name: string;
  /**
   * Stock courant (1ʳᵉ colonne) : commence par la qty préparée,
   * diminue à chaque envoi / mouvement.
   */
  stock: number;
  /** Total préparé aujourd’hui (somme des mouvements prepare) */
  prepared: number;
  /** Total envoyé à Gbégamey aujourd’hui */
  sentToGbegamey: number;
  sold: number;
  /** Sorties déclarées hors vente (gâté, casse, test…) */
  pertes: number;
  counted: number | null;
  observations: string;
};

export type ZogboDay = {
  date: string; // YYYY-MM-DD
  status: DayStatus;
  lines: ZogboLine[];
  /** Accompagnements vendus / stockés à Zogbo (riz, telibo…) */
  accompanimentLines?: GbegameyLocalLine[];
  movements: ZogboMovement[];
  updatedAt: string | null;
};

export type ZogboLineComputed = ZogboLine & {
  unitPrice: number;
  /** Stock de référence du jour : compté saisi sinon stock mouvementé */
  available: number;
  availableAmount: number;
  soldAmount: number;
  /** Reste estimé : disponible − vendu − pertes */
  theoreticalRemaining: number;
  /** Reste réel : compté − vendu (le comptage EST le stock du jour) */
  prevalentRemaining: number;
  /** Plafond de vente : comptage saisi s'il existe, sinon disponible − pertes */
  prevalentMaxSold: number;
  variance: number | null;
};

/** Ligne reçue de Zogbo — le stock reçu est lu depuis Zogbo, pas saisi ici */
export type GbegameyTransferLine = {
  productId: ProductId;
  name: string;
  /** Reste veille sur place (hors nouveau reçu) */
  initialStock: number;
  /**
   * Quantité réellement constatée à l’arrivée. `null` = non vérifiée :
   * on fait alors confiance à ce que Zogbo a déclaré envoyer.
   */
  received: number | null;
  sold: number;
  /** Sorties déclarées hors vente */
  pertes: number;
  counted: number | null;
  observations: string;
};

/** Plats préparés directement à Gbégamey */
export type GbegameyLocalLine = {
  productId: ProductId;
  name: string;
  /** Reste / stock en début de jour */
  initialStock: number;
  prepared: number;
  sold: number;
  /** Sorties déclarées hors vente */
  pertes: number;
  counted: number | null;
  observations: string;
};

export type GbegameyDay = {
  date: string;
  status: DayStatus;
  transferLines: GbegameyTransferLine[];
  localLines: GbegameyLocalLine[];
  updatedAt: string | null;
};

export type GbegameyTransferComputed = GbegameyTransferLine & {
  /** Ce que Zogbo a déclaré envoyer */
  sentFromZogbo: number;
  /** Ce qui entre en stock : toujours l'envoi déclaré (le constaté ne sert qu'à l'écart) */
  receivedFromZogbo: number;
  /** Envoyé − constaté : la perte sur le trajet (null si non vérifié) */
  transportVariance: number | null;
  unitPrice: number;
  /** Stock de référence du jour : compté saisi sinon init.+reçu (auto) */
  available: number;
  receivedAmount: number;
  soldAmount: number;
  /** Reste estimé : disponible − vendu − pertes */
  theoreticalRemaining: number;
  /** Stock restant réel : compté − vendu (le comptage EST le stock initial) */
  prevalentRemaining: number;
  /** Plafond de vente : comptage saisi s'il existe, sinon disponible − pertes */
  prevalentMaxSold: number;
  variance: number | null;
};

export type GbegameyLocalComputed = GbegameyLocalLine & {
  unitPrice: number;
  /** Stock de référence du jour : compté saisi sinon init.+préparé */
  available: number;
  soldAmount: number;
  theoreticalRemaining: number;
  /** Stock restant réel : compté − vendu (le comptage EST le stock initial) */
  prevalentRemaining: number;
  /** Plafond de vente : comptage saisi s'il existe, sinon disponible − pertes */
  prevalentMaxSold: number;
  variance: number | null;
};

/** Charges du jour (Suivi mensuel) */
export type DayCharges = {
  date: string;
  matieresPremieres: number;
  loyer: number;
  salaires: number;
  electricite: number;
  carburant: number;
  reparations: number;
  /**
   * Coût des pertes déclarées, valorisé au prix de revient. Calculé depuis le
   * journal des pertes, jamais saisi à la main : il doit toujours correspondre
   * aux déclarations.
   */
  pertes?: number;
  updatedAt: string | null;
};

export type DayRevenue = {
  /** CA plats simples Zogbo */
  caZogboPlats: number;
  /** CA plats Gbégamey (transferts uniquement, les locaux = accompagnements) */
  caGbegameyPlats: number;
  /** CA accompagnements Zogbo (frites, légumes… vendus « sur place ») */
  caAccompagnementsZogbo: number;
  /** CA accompagnements Gbégamey (plats locaux : attiéké, placali…) */
  caAccompagnementsGbegamey: number;
  caCombosZogbo: number;
  caCombosGbegamey: number;
  caBoissonsZogbo: number;
  caBoissonsGbegamey: number;
  /** Ventes extraordinaires (description libre) */
  caExtraZogbo: number;
  caExtraGbegamey: number;
  /** Point zone Zogbo = plats + accompagnements + combos + boissons + extra */
  caZogbo: number;
  /** Point zone Gbégamey = plats + accompagnements + combos + boissons + extra */
  caGbegamey: number;
  caAccompagnements: number;
  caCombos: number;
  caBoissons: number;
  caExtra: number;
  caTotal: number;
  varianceZogbo: number;
  varianceGbegamey: number;
  varianceBoissons: number;
  margeBoissons: number;
};

export type DayPoint = DayRevenue & {
  date: string;
  charges: DayCharges;
  chargesTotal: number;
  resultat: number;
  hasZogboData: boolean;
  hasGbegameyData: boolean;
  hasCombosData: boolean;
  hasBoissonsData: boolean;
};

/** Classement produits (CA) pour le tableau de bord */
export type ProductRank = {
  productId: string;
  name: string;
  kind: string;
  qty: number;
  ca: number;
};

export type RankPair = {
  best: ProductRank[];
  worst: ProductRank[];
};

export type SiteRank = {
  site: string;
  label: string;
  qty: number;
  ca: number;
};

export type ProductRanking = {
  /** Tous produits confondus (rétrocompat) */
  best: ProductRank[];
  worst: ProductRank[];
  /** Zone qui vend le plus */
  sites: SiteRank[];
  plats: RankPair;
  accompagnements: RankPair;
  boissons: RankPair;
};

/** Ventes + stock combos du jour (préparés à Zogbo, envoyés à Gbégamey) */
export type CombosLine = {
  productId: ProductId;
  name: string;
  /** Info catalogue (plat associé) — n’impacte plus le stock */
  baseDishName: string | null;
  /** Dispo Zogbo = préparés − envoyés (comme les plats) */
  stockZogbo: number;
  prepared: number;
  sentToGbegamey: number;
  soldZogbo: number;
  /** Sorties déclarées hors vente, côté Zogbo */
  pertesZogbo: number;
  countedZogbo: number | null;
  /** Reste Gbégamey en début de jour */
  initialGbegamey: number;
  soldGbegamey: number;
  /** Sorties déclarées hors vente, côté Gbégamey */
  pertesGbegamey: number;
  countedGbegamey: number | null;
  observations: string;
};

export type CombosMovementType = "prepare" | "send";

export type CombosMovement = {
  id: string;
  at: string;
  type: CombosMovementType;
  productId: ProductId;
  name: string;
  qty: number;
  /** Dispo Zogbo après le mouvement */
  stockAfter: number;
  cancelledAt: string | null;
};

export type CombosDay = {
  date: string;
  status: DayStatus;
  lines: CombosLine[];
  movements: CombosMovement[];
  updatedAt: string | null;
};

export type CombosLineComputed = CombosLine & {
  unitPrice: number;
  /** Reçu Gbégamey = envoyé depuis Zogbo */
  receivedGbegamey: number;
  availableZogbo: number;
  availableGbegamey: number;
  stockActuelZogbo: number;
  stockActuelGbegamey: number;
  soldTotal: number;
  soldAmount: number;
  soldAmountZogbo: number;
  soldAmountGbegamey: number;
  varianceZogbo: number | null;
  varianceGbegamey: number | null;
};

/** Inventaire boissons du jour — stock/achats en casiers, ventes en bouteilles */
export type BoissonsLine = {
  productId: ProductId;
  name: string;
  /** Stock reporté en casiers */
  initialStock: number;
  /** Achats du jour en casiers (somme des mouvements purchase actifs) */
  purchases: number;
  /** Ventes Zogbo en bouteilles */
  soldZogbo: number;
  /** Ventes Gbégamey en bouteilles */
  soldGbegamey: number;
  /** Sorties déclarées hors vente, en bouteilles */
  pertes: number;
  /** Comptage physique en bouteilles */
  counted: number | null;
  observations: string;
};

/** Entrée de stock boissons (achat) — traçable et annulable */
export type BoissonsMovementType = "purchase";

export type BoissonsMovement = {
  id: string;
  at: string;
  type: BoissonsMovementType;
  productId: ProductId;
  name: string;
  /** Quantité achetée en casiers */
  qty: number;
  /** Stock restant en casiers après ce mouvement */
  stockAfter: number;
  cancelledAt: string | null;
};

export type BoissonsDay = {
  date: string;
  status: DayStatus;
  lines: BoissonsLine[];
  movements: BoissonsMovement[];
  updatedAt: string | null;
};

export type BoissonsLineComputed = BoissonsLine & {
  purchasePrice: number;
  salePrice: number | null;
  unitsPerCasier: number;
  /** Solde casiers (init + achats) */
  available: number;
  /** Ventes totales en bouteilles */
  soldTotal: number;
  /** Ventes totales converties en casiers */
  soldCasiers: number;
  soldAmount: number;
  soldAmountZogbo: number;
  soldAmountGbegamey: number;
  margin: number | null;
  /** Reste théorique en casiers */
  theoreticalRemaining: number;
  /** Reste théorique en bouteilles (pour la vente) */
  stockBottles: number;
  variance: number | null;
};

export type MonthPoint = {
  year: number;
  month: number; // 1-12
  days: DayPoint[];
  totals: {
    caPlatsZogbo: number;
    caPlatsGbegamey: number;
    caAccompagnementsZogbo: number;
    caAccompagnementsGbegamey: number;
    caBoissonsZogbo: number;
    caBoissonsGbegamey: number;
    caExtraZogbo: number;
    caExtraGbegamey: number;
    caZogbo: number;
    caGbegamey: number;
    caCombos: number;
    caBoissons: number;
    caTotal: number;
    chargesTotal: number;
    resultat: number;
  };
};

export type YearPoint = {
  year: number;
  months: {
    month: number;
    caTotal: number;
    caCombos: number;
    chargesTotal: number;
    resultat: number;
    daysWithData: number;
  }[];
  totals: {
    caTotal: number;
    caCombos: number;
    chargesTotal: number;
    resultat: number;
  };
};

export type VenteSite = "zogbo" | "gbegamey";
export type VenteKind = "plat" | "combo" | "boisson" | "local" | "extra";

export type VenteProduct = {
  kind: VenteKind;
  productId: ProductId;
  name: string;
  unitPrice: number;
  soldToday: number;
  hint?: string | null;
  /** Stock restant vendable (plat / local / combo lié à une base) ; null = non plafonné */
  stockLeft?: number | null;
  /**
   * Stock encore vendable mais sous le seuil d’alerte : à réapprovisionner
   * avant la rupture, plutôt qu’une fois le stock à zéro.
   */
  lowStock?: boolean;
};

export type VenteLogEntry = {
  id: string;
  date: string;
  site: VenteSite;
  kind: VenteKind;
  productId: string;
  name: string;
  qty: number;
  unitPrice: number;
  amount: number;
  at: string;
  /** Origine de la ligne (caisse, carnet-zogbo, aquapro, reprise…) */
  source?: string | null;
};

export type VentesDaySummary = {
  lignes: number;
  articles: number;
  montant: number;
  byKind: Record<
    string,
    { lignes: number; qty: number; montant: number }
  >;
  bySource: Record<string, { lignes: number; montant: number }>;
};

/** Types de vente POS (AquaPro) */
export type SaleType = "Sur place" | "Rapido";

export type PosPaymentMethod = {
  id: string;
  libelle: string;
};

export type PosTable = {
  id: string;
  reference: string;
  emplacement: string;
};

export type PosServeur = {
  id: string;
  nom: string;
};

/** Fournisseur d'approvisionnement (matières, boissons) */
export type Fournisseur = {
  id: string;
  nom: string;
  contact?: string;
};

export type PosCompany = {
  nom: string | null;
  contacts: string | null;
  adresse: string | null;
  activites: string | null;
};

export type PosConfig = {
  paymentMethods: PosPaymentMethod[];
  tables: PosTable[];
  serveurs: PosServeur[];
  /** Fournisseurs proposés à la saisie d'un achat */
  fournisseurs: Fournisseur[];
  company: PosCompany | null;
  updatedAt: string | null;
};

export type CaisseStatut = "ouverte" | "fermee";

/**
 * Les caisses du réseau : le coffre central et une caisse par zone. Une caisse
 * n'appartient plus à un compte — c'est un tiroir du restaurant, ouvert par
 * quelqu'un et partagé par toute la zone.
 */
export type CaisseKey = "centrale" | "zogbo" | "gbegamey";

/**
 * Un versement déplace de l'argent d'une caisse à l'autre : il sort d'un côté,
 * entre de l'autre. Ce n'est ni une dépense ni une recette — le compte de
 * résultat ne doit jamais le voir, sans quoi verser la recette au coffre
 * apparaîtrait comme une charge.
 */
export type CaisseMouvementKind =
  | "depense"
  | "recette"
  | "versement-sortie"
  | "versement-entree";

export type CaisseMouvement = {
  id: string;
  caisseId: string;
  kind: CaisseMouvementKind;
  nature: string;
  beneficiaire: string;
  montant: number;
  at: string;
  /** Qui a saisi — la caisse étant partagée, c'est la seule traçabilité. */
  actorId?: string | null;
  actorName?: string | null;
  /** Versement : identifiant commun aux deux jambes, et caisse en face. */
  transfertId?: string | null;
  contrepartie?: CaisseKey | null;
  /** Annulation : le mouvement reste au journal, barré ; le total repris. */
  cancelledAt?: string | null;
  cancelledById?: string | null;
  cancelledByName?: string | null;
};

export type CaisseSession = {
  id: string;
  /** Caisse concernée — l'identité stable, indépendante de la session. */
  caisse: CaisseKey;
  date: string;
  /** Zone servie ; `null` pour la caisse centrale, qui ne vend pas. */
  site: VenteSite | null;
  /** Compte qui a ouvert la session. */
  userId: string;
  userName: string;
  statut: CaisseStatut;
  soldeInitial: number;
  totalVente: number;
  totalDepense: number;
  totalRecette: number;
  /** Versé à une autre caisse (sort du tiroir, hors charges). */
  totalVersementSorti: number;
  /** Reçu d'une autre caisse (entre au tiroir, hors produits). */
  totalVersementRecu: number;
  soldePhysique: number | null;
  soldeFermeture: number | null;
  commentaire: string | null;
  openedAt: string;
  closedAt: string | null;
  closedById: string | null;
  closedByName: string | null;
  updatedAt: string | null;
};

/** Vue d'ensemble des trois caisses — bandeau de consolidation. */
export type CaisseOverviewItem = {
  caisse: CaisseKey;
  session: CaisseSession | null;
  soldeTheorique: number;
};

export type PosTicketLine = {
  kind: VenteKind;
  productId: string;
  name: string;
  qty: number;
  unitPrice: number;
  amount: number;
  /** id ventes_log après validation */
  venteLogId?: string | null;
};

export type PosTicketStatut = "valide" | "annule";

export type PosTicket = {
  id: string;
  numero: string;
  date: string;
  site: VenteSite;
  statut: PosTicketStatut;
  saleType: SaleType;
  caisseId: string | null;
  paymentMethodId: string | null;
  paymentLabel: string | null;
  tableId: string | null;
  tableLabel: string | null;
  serveurId: string | null;
  serveurNom: string | null;
  clientNom: string | null;
  reduction: number;
  lines: PosTicketLine[];
  montantBrut: number;
  montant: number;
  userId: string;
  userName: string;
  /** Équipe créditée de ce ticket, figée à l'encaissement */
  shift?: UserShift;
  at: string;
  cancelledAt: string | null;
};

/** Journée matières / appro */
export type MatieresLine = {
  productId: ProductId;
  name: string;
  initialStock: number;
  purchases: number;
  consumed: number;
  /** Sorties déclarées hors consommation (gâté, casse…) */
  pertes: number;
  counted: number | null;
  observations: string;
};

export type MatieresMovement = {
  id: string;
  at: string;
  type: "purchase";
  productId: ProductId;
  name: string;
  qty: number;
  unitPrice: number;
  stockAfter: number;
  cancelledAt: string | null;
  /** Fournisseur de cet achat — permet de comparer les prix dans le temps */
  fournisseurId?: string | null;
  fournisseurNom?: string | null;
};

export type MatieresDay = {
  date: string;
  status: DayStatus;
  lines: MatieresLine[];
  movements: MatieresMovement[];
  updatedAt: string | null;
};
