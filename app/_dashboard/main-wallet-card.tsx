/**
 * Storehouse — Main Wallet Card (Server Component)
 *
 * Headlines the total USDC Storehouse has routed across all obligations,
 * read from the database (the same source of truth as the rest of the
 * dashboard). DB-derived rather than a live Circle call, so it is robust
 * across all runtimes and always reflects what the agent has actually done.
 */
import { supabaseAdminClient } from "@/lib/supabase/admin-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const revalidate = 30;

async function fetchTotalRouted(): Promise<string> {
  const { data, error } = await supabaseAdminClient
    .from("buckets")
    .select("current_balance");

  if (error || !data) {
    return "0.00";
  }

  const total = data.reduce(
    (sum, row: { current_balance: number | string }) =>
      sum + parseFloat(String(row.current_balance ?? "0")),
    0
  );

  return total.toFixed(2);
}

export async function MainWalletCard() {
  const total = await fetchTotalRouted();
  const formatted = parseFloat(total).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Total Routed to Obligations
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-4xl font-bold tracking-tight">
          ${formatted}
          <span className="text-base font-normal text-muted-foreground ml-2">
            USDC
          </span>
        </div>
        <div className="text-xs text-muted-foreground mt-2">
          storehouse-main · Arc Testnet
        </div>
      </CardContent>
    </Card>
  );
}
