/**
 * Scheduled function — every 15 minutes, trigger the autonomous aggressive-lane
 * deployer by POSTing to the auto-deploy endpoint with the shared secret.
 *
 * Kept thin: the deployment logic lives in the endpoint / lib. This just wakes
 * it on a schedule. Harmless when no bucket is aggressive (finds nothing).
 */
import type { Config } from "@netlify/functions";

export default async () => {
  const base = process.env.URL || "https://mystorehouse.ai";
  const secret = process.env.AUTO_DEPLOY_SECRET;
  if (!secret) {
    return new Response("AUTO_DEPLOY_SECRET not set", { status: 500 });
  }
  try {
    const res = await fetch(`${base}/api/executor/auto-deploy`, {
      method: "POST",
      headers: { "x-auto-deploy-secret": secret },
    });
    const body = await res.text();
    console.log("auto-deploy cron:", res.status, body.slice(0, 500));
    return new Response(body, { status: res.status });
  } catch (e) {
    console.error("auto-deploy cron failed:", e instanceof Error ? e.message : String(e));
    return new Response("cron error", { status: 500 });
  }
};

export const config: Config = {
  schedule: "*/15 * * * *", // every 15 minutes
};
