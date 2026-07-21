/**
 * Storehouse — Main Dashboard
 *
 * The single-page Storehouse dashboard. Emblem hero banner, then three
 * data sections, each a Server Component that fetches its own data. If one
 * fails, the others still render.
 */

import { Suspense } from "react";
import Image from "next/image";
import { MainWalletCard } from "./_dashboard/main-wallet-card";
import { ObligationsSection } from "./_dashboard/obligations-section";
import { RecentActivity } from "./_dashboard/recent-activity";

// Rendered per request. Without this, Next statically renders at build time
// and the dashboard serves a snapshot of whatever the database held when the
// site was built — balances and activity go stale until the next deploy.
export const dynamic = "force-dynamic";

function SectionLoading({ label }: { label: string }) {
  return (
    <div className="text-sm text-muted-foreground py-8 text-center">
      Loading {label}…
    </div>
  );
}

export default async function StorehousePage() {
  return (
    <main className="container mx-auto py-8 px-4 max-w-5xl space-y-6">
      {/* Emblem hero banner */}
      <div className="relative w-full overflow-hidden rounded-xl border border-border">
        <Image
          src="/storehouse-emblem.png"
          alt="Storehouse — a dove bearing an olive branch over a vault, wired into the Arc network"
          width={1408}
          height={768}
          priority
          className="w-full h-auto object-cover"
        />
      </div>

      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          Autonomous personal finance agent · Arc Testnet
        </p>
        <p className="text-xs text-muted-foreground/80 italic">
          &ldquo;Bring the full tithe into the storehouse&rdquo; · Malachi 3:10
        </p>
      </div>

      <Suspense fallback={<SectionLoading label="wallet" />}>
        <MainWalletCard />
      </Suspense>

      <Suspense fallback={<SectionLoading label="obligations" />}>
        <ObligationsSection />
      </Suspense>

      <Suspense fallback={<SectionLoading label="recent activity" />}>
        <RecentActivity />
      </Suspense>
    </main>
  );
}
