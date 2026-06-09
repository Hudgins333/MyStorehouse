/**
 * Storehouse — Main Wallet Card (Server Component)
 *
 * Shows the storehouse-main wallet's live USDC balance fetched from Circle's
 * API. Cached with a 60-second revalidation window so we don't hammer the API
 * on every page load.
 *
 * Live (Circle API) balance vs. DB-derived balance:
 *   - This card is the SOURCE OF TRUTH for "how much USDC is sitting in main"
 *   - Bucket balances elsewhere on the page come from the DB
 *   - Drift between the two would indicate a real bug worth investigating
 */

import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Server-side fetch with Next.js 60-second cache
export const revalidate = 60;

interface WalletBalanceResponse {
    data?: {
        tokenBalances?: Array<{
            amount: string;
            token: {
                symbol?: string;
                name?: string;
            };
        }>;
    };
}

async function fetchMainWalletUsdcBalance(): Promise<{
    balance: string;
    error: string | null;
}> {
    const apiKey = process.env.CIRCLE_API_KEY;
    const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
    const mainWalletId = process.env.STOREHOUSE_MAIN_WALLET_ID;

    if (!apiKey || !entitySecret || !mainWalletId) {
        return {
            balance: "0.00",
            error: "Missing Circle env vars",
        };
    }

    try {
        const circle = initiateDeveloperControlledWalletsClient({
            apiKey,
            entitySecret,
        });

        const response = (await circle.getWalletTokenBalance({
            id: mainWalletId,
        })) as WalletBalanceResponse;

        const tokenBalances = response?.data?.tokenBalances ?? [];

        // Find USDC entry
        const usdcEntry = tokenBalances.find(
            (b) =>
                b.token?.symbol?.toUpperCase() === "USDC" ||
                b.token?.name?.toLowerCase().includes("usdc")
        );

        if (!usdcEntry) {
            return { balance: "0.00", error: null };
        }

        // Circle returns amount as a human-readable string already (e.g. "100.50")
        return { balance: usdcEntry.amount, error: null };
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { balance: "0.00", error: message };
    }
}

export async function MainWalletCard() {
    const { balance, error } = await fetchMainWalletUsdcBalance();

    const formattedBalance = parseFloat(balance).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                    Main Wallet Balance
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="text-4xl font-bold tracking-tight">
                    ${formattedBalance}
                    <span className="text-base font-normal text-muted-foreground ml-2">
            USDC
          </span>
                </div>
                <div className="text-xs text-muted-foreground mt-2">
                    storehouse-main · Arc Testnet
                </div>
                {error ? (
                    <div className="text-xs text-destructive mt-2">
                        Could not fetch live balance: {error}
                    </div>
                ) : null}
            </CardContent>
        </Card>
    );
}