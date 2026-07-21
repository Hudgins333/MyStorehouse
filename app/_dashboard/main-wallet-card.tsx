/**
 * Storehouse — Main Wallet Card (Server Component)
 *
 * Two figures side by side:
 *
 *   Total Routed  — sum of bucket balances, DB-derived. What the agent has
 *                   actually moved into obligations.
 *   In Main       — live storehouse-main balance from Circle. Money that has
 *                   arrived but is not (yet) routed lives here, including
 *                   fiat-obligation allocations awaiting an offramp rail.
 *
 * The Circle read uses the REST balances endpoint with the API key only —
 * no entity secret, and therefore no SDK initialisation, which is what
 * previously failed in the serverless runtime. If the call fails for any
 * reason the card still renders the routed total rather than breaking.
 */
import { supabaseAdminClient } from "@/lib/supabase/admin-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const revalidate = 30;

async function fetchTotalRouted(): Promise<number> {
  const { data, error } = await supabaseAdminClient
    .from("buckets")
    .select("current_balance");

  if (error || !data) return 0;

  return data.reduce(
    (sum, row: { current_balance: number | string }) =>
      sum + parseFloat(String(row.current_balance ?? "0")),
    0
  );
}

/**
 * Live USDC balance of storehouse-main. Returns null on any failure so the
 * card degrades to showing only what the database knows.
 *
 * Note: Arc reports USDC twice — once as the native gas token (18 decimals)
 * and once as an ERC-20 (6 decimals). Same balance, two representations, so
 * we take the native entry and ignore the duplicate.
 */
async function fetchMainWalletBalance(): Promise<number | null> {
  const walletId = process.env.STOREHOUSE_MAIN_WALLET_ID;
  const apiKey = process.env.CIRCLE_API_KEY;
  if (!walletId || !apiKey) return null;

  try {
    const res = await fetch(
      `https://api.circle.com/v1/w3s/wallets/${walletId}/balances`,
      {
        headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
        cache: "no-store",
      }
    );

    if (!res.ok) {
      console.warn(`main-wallet-card: Circle balances returned ${res.status}`);
      return null;
    }

    const json = await res.json();
    const balances = json?.data?.tokenBalances ?? [];

    const usdc =
      balances.find((b: any) => b?.token?.symbol === "USDC" && b?.token?.isNative) ??
      balances.find((b: any) => b?.token?.symbol === "USDC");

    return usdc ? parseFloat(usdc.amount) : null;
  } catch (e) {
    console.warn(
      "main-wallet-card: Circle balance fetch failed:",
      e instanceof Error ? e.message : String(e)
    );
    return null;
  }
}

const money = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function MainWalletCard() {
  const [routed, mainBalance] = await Promise.all([
    fetchTotalRouted(),
    fetchMainWalletBalance(),
  ]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Total Routed to Obligations
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-4xl font-bold tracking-tight">
          ${money(routed)}
          <span className="text-base font-normal text-muted-foreground ml-2">
            USDC
          </span>
        </div>

        {mainBalance !== null && (
          <div className="mt-4 pt-4 border-t border-border">
            <div className="text-xs text-muted-foreground">Held in storehouse-main</div>
            <div className="text-xl font-semibold tracking-tight mt-0.5">
              ${money(mainBalance)}
              <span className="text-sm font-normal text-muted-foreground ml-1.5">
                USDC
              </span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Unrouted funds, including fiat legs awaiting an offramp rail
            </div>
          </div>
        )}

        <div className="text-xs text-muted-foreground mt-3">
          storehouse-main · Arc Testnet
        </div>
      </CardContent>
    </Card>
  );
}
