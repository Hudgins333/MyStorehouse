/**
 * Storehouse — Autonomous pipeline orchestrator
 *
 * Runs the full cognition+execution loop for a single income_event:
 *   classify -> route -> execute
 *
 * Designed to be called fire-and-forget from the inbound webhook handler:
 * the webhook returns 200 immediately and this runs detached. It therefore
 * NEVER throws to its caller — every stage is wrapped, errors are logged,
 * and the event is left in a recoverable state for manual inspection.
 *
 * This is the same sequence the CLI runners do by hand (run-classifier ->
 * run-router -> run-executor), lifted into one callable so a single faucet
 * drop drives the whole loop with zero CLI.
 */

import { classifyIncomeEvent } from "./classifier";
import { routeIncomeEvent } from "./router";
import { executeRoutingDecision } from "./executor";
import { supabaseAdminClient } from "../supabase/admin-client";
import { IncomeEventRow } from "./types";

export interface PipelineResult {
  incomeEventId: string;
  classified: boolean;
  routed: boolean;
  validated: boolean;
  executed: boolean;
  routingDecisionId: string | null;
  stage: "classify" | "route" | "execute" | "complete";
  error: string | null;
}

/**
 * Runs classify -> route -> execute for one income_event.
 * Never throws; returns a PipelineResult describing how far it got.
 */
export async function runPipeline(
  incomeEventId: string
): Promise<PipelineResult> {
  const result: PipelineResult = {
    incomeEventId,
    classified: false,
    routed: false,
    validated: false,
    executed: false,
    routingDecisionId: null,
    stage: "classify",
    error: null,
  };

  const tag = `[pipeline ${incomeEventId.slice(0, 8)}]`;

  // ----- Load the event -----
  let event: IncomeEventRow;
  try {
    const { data, error } = await supabaseAdminClient
      .from("income_events")
      .select("*")
      .eq("id", incomeEventId)
      .single();
    if (error || !data) {
      result.error = `load failed: ${error?.message ?? "not found"}`;
      console.error(`${tag} ${result.error}`);
      return result;
    }
    event = data as IncomeEventRow;
  } catch (e) {
    result.error = `load threw: ${e instanceof Error ? e.message : String(e)}`;
    console.error(`${tag} ${result.error}`);
    return result;
  }

  // Guard: only run on a fresh, unclassified, arrived-on-arc event.
  if (event.classification !== null) {
    console.log(`${tag} already classified (${event.classification}) — skipping pipeline`);
    result.classified = true;
    return result;
  }
  if (event.status !== "arrived_on_arc") {
    console.log(`${tag} status=${event.status}, not arrived_on_arc — skipping pipeline`);
    return result;
  }

  // ----- Stage 1: classify -----
  result.stage = "classify";
  try {
    await classifyIncomeEvent(event);
    result.classified = true;
    console.log(`${tag} classified`);
  } catch (e) {
    result.error = `classify: ${e instanceof Error ? e.message : String(e)}`;
    console.error(`${tag} ${result.error}`);
    return result;
  }

  // Re-load the event now that classification is written.
  let classifiedEvent: IncomeEventRow;
  try {
    const { data, error } = await supabaseAdminClient
      .from("income_events")
      .select("*")
      .eq("id", incomeEventId)
      .single();
    if (error || !data) {
      result.error = `reload after classify failed: ${error?.message ?? "not found"}`;
      console.error(`${tag} ${result.error}`);
      return result;
    }
    classifiedEvent = data as IncomeEventRow;
  } catch (e) {
    result.error = `reload threw: ${e instanceof Error ? e.message : String(e)}`;
    console.error(`${tag} ${result.error}`);
    return result;
  }

  // ----- Stage 2: route -----
  result.stage = "route";
  let decisionId: string;
  try {
    const routeResult = await routeIncomeEvent(classifiedEvent);
    result.routed = true;
    result.validated = routeResult.validated;
    result.routingDecisionId = routeResult.routing_decision_id;
    decisionId = routeResult.routing_decision_id;
    if (!routeResult.validated) {
      result.error = `route not validated: ${routeResult.validation_errors.join("; ")}`;
      console.warn(`${tag} ${result.error}`);
      return result;
    }
    console.log(`${tag} routed -> decision ${decisionId.slice(0, 8)} (validated)`);
  } catch (e) {
    result.error = `route: ${e instanceof Error ? e.message : String(e)}`;
    console.error(`${tag} ${result.error}`);
    return result;
  }

  // ----- Stage 3: execute -----
  result.stage = "execute";
  try {
    const { data: decision, error } = await supabaseAdminClient
      .from("routing_decisions")
      .select("id, income_event_id, plan, validated, executed_at")
      .eq("id", decisionId)
      .single();
    if (error || !decision) {
      result.error = `load decision failed: ${error?.message ?? "not found"}`;
      console.error(`${tag} ${result.error}`);
      return result;
    }
    const execResult = await executeRoutingDecision(decision as any);
    result.executed = execResult.failed === 0;
    if (execResult.failed > 0) {
      result.error = `execute: ${execResult.failed} leg(s) failed: ${execResult.errors.join("; ")}`;
      console.warn(`${tag} ${result.error}`);
    } else {
      console.log(
        `${tag} executed: ${execResult.submitted} submitted, ${execResult.pending_offramp} pending_offramp`
      );
    }
  } catch (e) {
    result.error = `execute: ${e instanceof Error ? e.message : String(e)}`;
    console.error(`${tag} ${result.error}`);
    return result;
  }

  result.stage = "complete";
  console.log(`${tag} pipeline complete`);
  return result;
}
