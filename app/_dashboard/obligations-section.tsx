/**
 * Storehouse — Obligations Section (Server Component)
 *
 * Displays the user's active obligations as a table, with each obligation's
 * routed bucket balance. Bucket balance comes from the DB (confirmed transfers
 * credited via confirm_transfer), not from Circle directly.
 *
 * The savings obligation additionally shows its dual-asset composition: half of
 * each confirmed savings deposit is swapped USDC -> EURC (see lib/agents/swapper),
 * so its row breaks out how much remains liquid USDC vs. how much became EURC.
 */
import { supabaseAdminClient } from "@/lib/supabase/admin-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

// The savings obligation — the one with the USDC -> EURC diversification swap.
const SAVINGS_OBLIGATION_ID = "de1c6c24-3e66-4738-a7d7-4cc6e7d4e3d4";

interface ObligationWithBucket {
    id: string;
    name: string;
    type: "percentage" | "fixed" | "goal";
    amount: string | null;
    priority: number;
    destination_type: "onchain" | "fiat_offramp";
    due_date: string | null;
    current_balance: string;
}

interface SavingsSwapSummary {
    usdcSwapped: number; // total USDC converted out
    eurcReceived: number; // total EURC received
    swapCount: number;
}

async function loadObligationsWithBuckets(): Promise<ObligationWithBucket[]> {
    const { data, error } = await supabaseAdminClient
        .from("obligations")
        .select(
            `
        id,
        name,
        type,
        amount,
        priority,
        destination_type,
        due_date,
        buckets ( current_balance )
      `
        )
        .eq("active", true)
        .order("priority", { ascending: true });
    if (error || !data) {
        return [];
    }
    return data.map((row: any) => ({
        id: row.id,
        name: row.name,
        type: row.type,
        amount: row.amount,
        priority: row.priority,
        destination_type: row.destination_type,
        due_date: row.due_date,
        current_balance: String(
            (Array.isArray(row.buckets)
                ? row.buckets[0]?.current_balance
                : row.buckets?.current_balance) ?? "0"
        ),
    }));
}

async function loadSavingsSwapSummary(): Promise<SavingsSwapSummary> {
    const { data, error } = await supabaseAdminClient
        .from("swaps")
        .select("amount_in, amount_out, status")
        .eq("obligation_id", SAVINGS_OBLIGATION_ID)
        .eq("status", "executed");

    if (error || !data) {
        return { usdcSwapped: 0, eurcReceived: 0, swapCount: 0 };
    }

    return data.reduce<SavingsSwapSummary>(
        (acc, row: any) => ({
            usdcSwapped: acc.usdcSwapped + parseFloat(row.amount_in ?? "0"),
            eurcReceived: acc.eurcReceived + parseFloat(row.amount_out ?? "0"),
            swapCount: acc.swapCount + 1,
        }),
        { usdcSwapped: 0, eurcReceived: 0, swapCount: 0 }
    );
}

function formatObligationAmount(o: ObligationWithBucket): string {
    if (o.type === "percentage" && o.amount) {
        return `${(parseFloat(o.amount) * 100).toFixed(0)}%`;
    }
    if (o.type === "fixed" && o.amount) {
        return `$${parseFloat(o.amount).toFixed(2)}`;
    }
    if (o.type === "goal" && o.amount) {
        return `Goal: $${parseFloat(o.amount).toFixed(2)}`;
    }
    return "remainder";
}

function formatBucketBalance(b: string): string {
    return parseFloat(b).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

function formatAmount(n: number): string {
    return n.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

export async function ObligationsSection() {
    const [obligations, savingsSwaps] = await Promise.all([
        loadObligationsWithBuckets(),
        loadSavingsSwapSummary(),
    ]);

    return (
        <Card>
            <CardHeader>
                <CardTitle>Obligations</CardTitle>
            </CardHeader>
            <CardContent>
                {obligations.length === 0 ? (
                    <div className="text-sm text-muted-foreground py-4 text-center">
                        No active obligations.
                    </div>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-12">#</TableHead>
                                <TableHead>Name</TableHead>
                                <TableHead>Type</TableHead>
                                <TableHead>Amount</TableHead>
                                <TableHead>Destination</TableHead>
                                <TableHead className="text-right">Routed</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {obligations.map((o) => {
                                const isSavings =
                                    o.id === SAVINGS_OBLIGATION_ID &&
                                    savingsSwaps.swapCount > 0;
                                const liquidUsdc =
                                    parseFloat(o.current_balance) - savingsSwaps.usdcSwapped;

                                return (
                                    <TableRow key={o.id}>
                                        <TableCell className="text-muted-foreground">
                                            {o.priority}
                                        </TableCell>
                                        <TableCell className="font-medium">{o.name}</TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className="capitalize">
                                                {o.type}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>{formatObligationAmount(o)}</TableCell>
                                        <TableCell>
                                            <Badge
                                                variant={
                                                    o.destination_type === "onchain"
                                                        ? "default"
                                                        : "secondary"
                                                }
                                            >
                                                {o.destination_type === "onchain" ? "onchain" : "fiat"}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right font-mono">
                                            <div>${formatBucketBalance(o.current_balance)}</div>
                                            {isSavings && (
                                                <div className="text-xs text-muted-foreground mt-0.5">
                                                    ↳ {formatAmount(Math.max(liquidUsdc, 0))} USDC ·{" "}
                                                    {formatAmount(savingsSwaps.eurcReceived)} EURC
                                                </div>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                )}
            </CardContent>
        </Card>
    );
}