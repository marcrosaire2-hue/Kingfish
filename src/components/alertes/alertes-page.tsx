"use client";

import { AppShell } from "@/components/app-shell";
import { MailAlertsPanel } from "@/components/admin/mail-alerts-panel";
import { VentesLiveNotifier } from "@/components/admin/ventes-live-notifier";

export function AlertesPage() {
  return (
    <AppShell title="Alertes" mainClassName="main-alertes">
      <div className="equipe-mail">
        <VentesLiveNotifier />
        <MailAlertsPanel />
        <section className="equipe-mail-panel">
          <h3>Sauvegarde</h3>
          <a className="btn btn-ghost" href="/api/admin/sauvegarde" download>
            Télécharger une sauvegarde
          </a>
        </section>
      </div>
    </AppShell>
  );
}
