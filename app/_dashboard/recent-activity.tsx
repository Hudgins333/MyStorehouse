/**
 * Storehouse — Recent Activity Section (Server Component)
 *
 * The story of recent agent decisions. For each recent income_event we show:
 *   - When it arrived, amount, source chain
 *   - How the Classifier labeled it (type, confidence, reasoning)
 *   - What the Router decided (allocation summary, reasoning)
 *   - Execution state (submitted / pending / failed)
 *   - Any savings diversification swap (USDC -> EURC) that followed
 *
 * This is the "watch Storehouse think" view. Most interesting section in a
 * demo because it shows the audit trail in plain English.
 */

import { supabaseAdminClient } from "@/lib/supabase/admin-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const MAX_EVENTS = 5;

interface IncomeEvent {
    id: string;
    source_tx_hash: string;
    source_chain: string;
    amount: string;
    classification: string | null;
    classification_confidence: number | null;
    classification_reasoning: string | null;
    status: string;
    received_at: string;
}

interface RoutingDecision {
    id: string;
    income_event_id: string;
    plan: any;
    llm_reasoning: string;
    validated: boolean;
    executed_at: string | null;
}

interface Transfer {
    id: string;
    routing_decision_id: string;
    obligation_id: string;
    amount: string;
    status: string;
}

interface Swap {
    id: string;
    transfer_id: string;
    token_in: string;
    token_out: string;
    amount_in: string;
    amount_out: string | null;
    status: string;
}

async function loadActivityData(): Promise<{
    events: IncomeEvent[];
    decisionsByEvent: Map<string, RoutingDecision>;
    transfersByDecision: Map<string, Transfer[]>;
    obligationNames: Map<string, string>;
    swapsByDecision: Map<string, Swap[]>;
}> {
    // Get recent income events
    const { data: events } = await supabaseAdminClient
        .from("income_events")
        .select("*")
        .order("received_at", { ascending: false })
        .limit(MAX_EVENTS);

    const eventList = (events ?? []) as IncomeEvent[];
    const eventIds = eventList.map((e) => e.id);

    // Get the validated routing_decision for each (if any)
    let decisions: RoutingDecision[] = [];
    if (eventIds.length > 0) {
        const { data } = await supabaseAdminClient
            .from("routing_decisions")
            .select("id, income_event_id, plan, llm_reasoning, validated, executed_at")
            .in("income_event_id", eventIds)
            .eq("validated", true);
        decisions = (data ?? []) as RoutingDecision[];
    }

    const decisionsByEvent = new Map<string, RoutingDecision>();
    for (const d of decisions) {
        decisionsByEvent.set(d.income_event_id, d);
    }

    // Get transfers for each decision
    let transfers: Transfer[] = [];
    const decisionIds = decisions.map((d) => d.id);
    if (decisionIds.length > 0) {
        const { data } = await supabaseAdminClient
            .from("transfers")
            .select("id, routing_decision_id, obligation_id, amount, status")
            .in("routing_decision_id", decisionIds);
        transfers = (data ?? []) as Transfer[];
    }

    const transfersByDecision = new Map<string, Transfer[]>();
    for (const t of transfers) {
        const list = transfersByDecision.get(t.routing_decision_id) ?? [];
        list.push(t);
        transfersByDecision.set(t.routing_decision_id, list);
    }

    // Get swaps that followed any of these transfers, keyed back to the decision
    // via the transfer they belong to. Build transfer_id -> decision_id first.
    const transferToDecision = new Map<string, string>();
    for (const t of transfers) {
        transferToDecision.set(t.id, t.routing_decision_id);
    }

    const swapsByDecision = new Map<string, Swap[]>();
    const transferIds = transfers.map((t) => t.id);
    if (transferIds.length > 0) {
        const { data } = await supabaseAdminClient
            .from("swaps")
            .select("id, transfer_id, token_in, token_out, amount_in, amount_out, status")
            .in("transfer_id", transferIds)
            .eq("status", "executed");
        for (const s of (data ?? []) as Swap[]) {
            const decId = transferToDecision.get(s.transfer_id);
            if (!decId) continue;
            const list = swapsByDecision.get(decId) ?? [];
            list.push(s);
            swapsByDecision.set(decId, list);
        }
    }

    // Get obligation names referenced by any transfer
    const obligationIds = Array.from(
        new Set(transfers.map((t) => t.obligation_id))
    );
    const obligationNames = new Map<string, string>();
    if (obligationIds.length > 0) {
        const { data } = await supabaseAdminClient
            .from("obligations")
            .select("id, name")
            .in("id", obligationIds);
        for (const row of (data ?? []) as { id: string; name: string }[]) {
            obligationNames.set(row.id, row.name);
        }
    }

    return {
        events: eventList,
        decisionsByEvent,
        transfersByDecision,
        obligationNames,
        swapsByDecision,
    };
}

function relativeTime(iso: string): string {
    const then = new Date(iso).getTime();
    const now = Date.now();
    const diffMs = now - then;
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);

    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;
    return new Date(iso).toLocaleDateString();
}

/**
 * Human-readable transfer statuses. 'pending_offramp' means the agent
 * allocated to a fiat obligation and recorded it, but the offramp adapter
 * is not yet wired — the leg is waiting on a rail, not failed.
 */
function statusLabel(status: string): string {
    const labels: Record<string, string> = {
        pending_offramp: "awaiting fiat rail",
    };
    return labels[status] ?? status;
}

function classificationBadgeVariant(
    c: string | null
): "default" | "secondary" | "outline" {
    if (!c) return "outline";
    if (c === "paycheck") return "default";
    if (c === "unknown") return "outline";
    return "secondary";
}

export async function RecentActivity() {
    const {
        events,
        decisionsByEvent,
        transfersByDecision,
        obligationNames,
        swapsByDecision,
    } = await loadActivityData();

    return (
        <Card>
            <CardHeader>
                <CardTitle>Recent Activity</CardTitle>
            </CardHeader>
            <CardContent>
                {events.length === 0 ? (
                    <div className="text-sm text-muted-foreground py-4 text-center">
                        No recent activity yet.
                    </div>
                ) : (
                    <div className="space-y-6">
                        {events.map((event) => {
                            const decision = decisionsByEvent.get(event.id);
                            const transfers = decision
                                ? transfersByDecision.get(decision.id) ?? []
                                : [];
                            const swaps = decision
                                ? swapsByDecision.get(decision.id) ?? []
                                : [];

                            return (
                                <div
                                    key={event.id}
                                    className="border-l-2 border-muted pl-4 pb-2"
                                >
                                    <div className="flex items-baseline justify-between mb-2">
                                        <div className="font-medium">
                                            {parseFloat(event.amount).toLocaleString("en-US", {
                                                minimumFractionDigits: 2,
                                                maximumFractionDigits: 2,
                                            })}{" "}
                                            USDC arrived
                                            <span className="text-muted-foreground text-sm ml-2">
                        via {event.source_chain}
                      </span>
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                            {relativeTime(event.received_at)}
                                        </div>
                                    </div>

                                    {/* Classification */}
                                    {event.classification ? (
                                        <div className="text-sm mb-2">
                                            <Badge
                                                variant={classificationBadgeVariant(event.classification)}
                                                className="mr-2"
                                            >
                                                {event.classification}
                                            </Badge>
                                            {event.classification_confidence !== null ? (
                                                <span className="text-xs text-muted-foreground">
                          confidence{" "}
                                                    {(event.classification_confidence as number).toFixed(2)}
                        </span>
                                            ) : null}
                                            {event.classification_reasoning ? (
                                                <div className="text-xs text-muted-foreground mt-1 italic">
                                                    "{event.classification_reasoning}"
                                                </div>
                                            ) : null}
                                        </div>
                                    ) : (
                                        <div className="text-xs text-muted-foreground mb-2">
                                            Awaiting classification
                                        </div>
                                    )}

                                    {/* Routing decision */}
                                    {decision ? (
                                        <div className="text-sm mt-3">
                                            <div className="flex flex-wrap gap-2 mb-2">
                                                {transfers.map((t) => (
                                                    <div
                                                        key={t.id}
                                                        className="bg-muted rounded-md px-2 py-1 text-xs"
                                                    >
                            <span className="font-medium">
                              {obligationNames.get(t.obligation_id) ?? "?"}
                            </span>
                                                        <span className="text-muted-foreground ml-1">
                              {parseFloat(t.amount).toFixed(2)}
                            </span>
                                                        <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                              {statusLabel(t.status)}
                            </span>
                                                    </div>
                                                ))}
                                            </div>

                                            {/* Savings diversification swap(s) */}
                                            {swaps.map((s) => (
                                                <div
                                                    key={s.id}
                                                    className="text-xs text-muted-foreground mb-2 flex items-center gap-1"
                                                >
                                                    <span>↳ Diversified savings:</span>
                                                    <span className="font-medium text-foreground">
                            {parseFloat(s.amount_in).toFixed(2)} {s.token_in}
                          </span>
                                                    <span>→</span>
                                                    <span className="font-medium text-foreground">
                            {s.amount_out
                                ? parseFloat(s.amount_out).toFixed(2)
                                : "?"}{" "}
                                                        {s.token_out}
                          </span>
                                                    <Badge variant="outline" className="ml-1 text-[10px]">
                                                        swap
                                                    </Badge>
                                                </div>
                                            ))}

                                            {decision.llm_reasoning ? (
                                                <div className="text-xs text-muted-foreground italic">
                                                    "{decision.llm_reasoning}"
                                                </div>
                                            ) : null}
                                            {decision.executed_at ? (
                                                <div className="text-[10px] text-muted-foreground mt-1 uppercase tracking-wide">
                                                    Executed {relativeTime(decision.executed_at)}
                                                </div>
                                            ) : null}
                                        </div>
                                    ) : event.classification ? (
                                        <div className="text-xs text-muted-foreground italic">
                                            Classified but not yet routed
                                        </div>
                                    ) : null}
                                </div>
                            );
                        })}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}