"use client";

import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { GUIDES } from "@/lib/guides";

export function GuideHubPage() {
  return (
    <AppShell
      title="Guides"
      subtitle="Mode d’emploi King Fish Manager — cliquez sur un guide pour le parcours étape par étape."
    >
      <p className="section-hint">
        Commencez par <strong>Démarrage</strong> si c’est votre première
        utilisation, puis ouvrez le guide de l’espace sur lequel vous travaillez.
      </p>

      <div className="guide-grid">
        {GUIDES.map((guide) => (
          <Link
            key={guide.slug}
            href={`/guide/${guide.slug}`}
            className="guide-card"
          >
            <span className="guide-card-space">{guide.space}</span>
            <span className="guide-card-title">{guide.title}</span>
            <span className="guide-card-summary">{guide.summary}</span>
            <span className="guide-card-meta">
              {guide.steps.length} étapes
              <span aria-hidden> →</span>
            </span>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}
