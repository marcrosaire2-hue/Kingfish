"use client";

import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import type { Guide } from "@/lib/guides";

export function GuideDetailPage({ guide }: { guide: Guide }) {
  return (
    <AppShell
      title={guide.title}
      subtitle={guide.summary}
      actions={
        <>
          <Link href="/guide" className="btn btn-ghost">
            Tous les guides
          </Link>
          {guide.href !== "/" ? (
            <Link href={guide.href} className="btn btn-primary">
              Ouvrir {guide.space}
            </Link>
          ) : null}
        </>
      }
    >
      <p className="section-hint">
        Espace : <strong>{guide.space}</strong>
        {" · "}
        Suivez les étapes dans l’ordre.
      </p>

      <ol className="guide-steps">
        {guide.steps.map((step, index) => (
          <li key={step.title} className="guide-step">
            <div className="guide-step-index" aria-hidden>
              {index + 1}
            </div>
            <div className="guide-step-body">
              <h2 className="guide-step-title">{step.title}</h2>
              <p>{step.body}</p>
            </div>
          </li>
        ))}
      </ol>

      {guide.tips && guide.tips.length > 0 ? (
        <section className="panel guide-tips">
          <h2 className="panel-title">À retenir</h2>
          <ul className="guide-tips-list">
            {guide.tips.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="guide-footer-nav">
        <Link href="/guide" className="btn-link">
          ← Retour à la liste des guides
        </Link>
        {guide.href !== "/" ? (
          <Link href={guide.href} className="btn-link">
            Aller à {guide.space} →
          </Link>
        ) : null}
      </div>
    </AppShell>
  );
}
