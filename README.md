# King Fish Manager

Application de gestion pour **King Fish** (Zogbo + Gbégamey) : ventes, caisse, stocks, pilotage et administration.

## Prérequis

- Node.js 22+
- MongoDB (Atlas ou local)
- Fichier `.env.local` à la racine :

```env
MONGODB_URI=mongodb+srv://...
MONGODB_DB=gestion_restaurant
AUTH_SECRET=une-chaine-secrete-longue-et-aleatoire
```

## Démarrage local

```bash
npm ci
npm run dev
```

Ouvrir [http://localhost:3000](http://localhost:3000)

## Comptes

Les utilisateurs sont gérés dans **Administration** (`/admin`).

| Profil | Accès |
|--------|--------|
| **Marc** (direction) | Tableau de bord, journal ventes, journal stock, registre, création de comptes |
| **daff** (admin opérationnel) | Tout l'admin sauf création de comptes |
| **Gérant / vendeur** | Selon zone (Zogbo ou Gbégamey) |

## Ventes Excel (sans combos)

Le gérant peut saisir les ventes du jour dans Excel puis les importer :

```bash
npm run excel:ventes          # génère KingFish-Ventes-Jour.xlsx
npm run excel:import          # simulation
npm run excel:import:apply    # écriture MongoDB + resync stock
```

Voir [KingFish-Ventes-Jour-SPEC.md](./KingFish-Ventes-Jour-SPEC.md).

## Sauvegarde

```bash
npm run sauvegarde
npm run restaurer -- chemin/vers/dump
```

Un workflow GitHub Actions sauvegarde aussi la base (`/.github/workflows/sauvegarde.yml`).

## Déploiement Render

1. Créer un **Web Service** sur [render.com](https://render.com) depuis ce dépôt, branche `main`
2. Le fichier `render.yaml` configure build et start
3. Variables obligatoires dans le tableau de bord Render :
   - `MONGODB_URI`
   - `MONGODB_DB` = `gestion_restaurant`
   - `AUTH_SECRET` (généré automatiquement si non défini)
4. **Manual Deploy** après chaque push sur `main`
5. URL de santé : `/login`
6. **Mails digests** (Gmail OAuth + liste Alertes mail) — Cron Jobs Render (ou équivalent) :
   - Quotidien ~00:15 : `GET /api/mail/cron?kind=day` + header `Authorization: Bearer $MAIL_CRON_SECRET` → bilan de la **veille** (articles, qté, totaux)
   - 1er du mois ~00:30 : `?kind=month` → bilan détaillé du **mois précédent**
   - Variables : `GMAIL_*`, `MAIL_CRON_SECRET`, optionnel `MAIL_ALERT_TO`, `MAIL_DIGEST_NOTIFY=0` pour couper

## Scripts utiles

| Script | Description |
|--------|-------------|
| `scripts/generate-saisie-gerant-workbook.mjs` | Génère le classeur ventes jour |
| `scripts/import-ventes-jour-excel.mjs` | Import Excel → ventes_log |
| `scripts/resync-sold-depuis-ventes-log.mjs` | Réaligne sold sur ventes_log |
| `scripts/analyser-incoherences-ventes-stock.mjs` | Diagnostic ventes ↔ stock |

## Qualité

```bash
npm run typecheck
npm test
npm run build
```

CI GitHub sur chaque push / PR (`main`).

## Pages principales

- **Quotidien** : Vente, Caisse, Zogbo, Gbégamey, Achats, Pertes
- **Pilotage** : Journal ventes, Journal stock, Régularisation, Stock, Registre
- **Admin** : Paramètres, Compte de résultat, Administration

Les routes `/historique-ventes` et `/boissons` redirigent vers les pages actuelles.
