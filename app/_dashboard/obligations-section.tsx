/**
 * Storehouse — Obligations Section (Server Component)
 *
 * Displays the user's active obligations as a table, with each obligation's
 * current bucket balance. Bucket balance comes from the DB, not from Circle —
 * this represents what Storehouse has *successfully routed* to that bucket
 * (i.e. confirmed transfers only, when confirmation webhook is implemented).
 *
 * For today (pre-confirmation-webhook), buckets.current_balance is whatever
 * the executor wrote on each routing. May not match on-chain reality if any
 * transfers failed post-submit. That gap closes in the next session.
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

export async function ObligationsSection() {
    const obligations = await loadObligationsWithBuckets();

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
                                <TableHead className="text-right">Bucket Balance</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {obligations.map((o) => (
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
                                        ${formatBucketBalance(o.current_balance)}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </CardContent>
        </Card>
    );
}