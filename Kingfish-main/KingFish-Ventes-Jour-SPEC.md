# King Fish — Ventes par jour (Excel)

Classeur opérationnel pour saisir les ventes **plats · accompagnements · boissons** (sans combos).

## Fichier

- `KingFish-Ventes-Jour.xlsx` (généré)
- Copie : `exports/KingFish-Ventes-Jour.xlsx`

## Feuilles

| Feuille | Rôle |
|---------|------|
| **Guide** | Mode d'emploi |
| **Plats / Accompagnements / Boissons** | Listes de référence (catalogue) |
| **Ventes** | Toutes les lignes : Date · Site · Catégorie · Produit · Quantité |
| **J_AAAA-MM-JJ_Z/G** | Saisie du jour (optionnel) — Z = Zogbo, G = Gbégamey |

## Commandes

```bash
# Générer le classeur (depuis MongoDB si .env.local)
npm run excel:ventes

# Simuler l'import
npm run excel:import

# Importer en base (remplace le journal plat/accomp/boisson du jour, garde les tickets POS)
npm run excel:import:apply
```

## Règles d'import

- Catégories acceptées : `plat`, `accompagnement`, `boisson`
- Site : `zogbo` ou `gbegamey`
- Les lignes liées à un **ticket POS** ne sont pas supprimées
- Les compteurs **sold** sont réalignés après import
- Sauvegarde recommandée : `npm run sauvegarde`
