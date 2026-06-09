/**
 * Storehouse — Main Dashboard
 *
 * The single-page Storehouse dashboard. Replaces the arc-commerce credit-
 * purchase landing page entirely.
 *
 * Server Component composition: three sections, each a Server Component
 * that fetches its own data. If one fails, the others still render.
 */

import { Suspense } from "react";
import { MainWalletCard } from "./_dashboard/main-wallet-card";
import { ObligationsSection } from "./_dashboard/obligations-section";
import { RecentActivity } from "./_dashboard/recent-activity";

export default async function StorehousePage() {
  return (
      <main className="container mx-auto py-8 px-4 max-w-5xl space-y-6">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">Storehouse</h1>
          <p className="text-sm text-muted-foreground">
            Autonomous personal finance agent · Arc Testnet
          </p>
        </div>

        <Suspense fallback={<SectionLoading label="Main wallet" />}>
          <MainWalletCard />
        </Suspense>

        <Suspense fallback={<SectionLoading label="Obligations" />}>
          <ObligationsSection />
        </Suspense>

        <Suspense fallback={<SectionLoading label="Recent activity" />}>
          <RecentActivity />
        </Suspense>
      </main>
  );
}

function SectionLoading({ label }: { label: string }) {
  return (
      <div className="rounded-md border border-muted p-6 text-sm text-muted-foreground">
        Loading {label}…
      </div>
  );
}