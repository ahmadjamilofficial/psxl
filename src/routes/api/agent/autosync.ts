import { createFileRoute } from "@tanstack/react-router";
import { serverEnv } from "@/lib/env.server";

const PAGE_SIZE = 40;
const MAX_CONSECUTIVE_ERRORS = 3;
const CONCURRENCY = 4;
const SCHEDULE_WINDOW_MS = 15 * 60 * 1000;

function equalSecret(expected: string, actual: string): boolean {
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(actual);
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a[i]! ^ b[i]!;
  return mismatch === 0;
}

export const Route = createFileRoute("/api/agent/autosync")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const secret = serverEnv("WAB_AUTOSYNC_SECRET");
        if (!secret || secret.length < 32) {
          return Response.json(
            { error: "Scheduled sync is not configured with a sufficiently strong server secret." },
            { status: 503, headers: { "Cache-Control": "no-store" } },
          );
        }
        const authorization = request.headers.get("authorization") ?? "";
        const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
        if (!equalSecret(secret, supplied)) {
          return Response.json(
            { error: "Unauthorized" },
            { status: 401, headers: { "Cache-Control": "no-store" } },
          );
        }

        const [{ supabaseAdmin }, integrationService] = await Promise.all([
          import("@/integrations/supabase/client.server"),
          import("@/lib/integrations/service.server"),
        ]);
        integrationService.bindIntegrationsClient(supabaseAdmin as never);
        try {
          const { data: connections, error } = await supabaseAdmin
            .from("provider_connections")
            .select("id,org_id")
            .in("status", ["connected", "error"])
            .lt("consecutive_errors", MAX_CONSECUTIVE_ERRORS)
            .order("last_sync_at", { ascending: true, nullsFirst: true })
            .limit(PAGE_SIZE);
          if (error) {
            return Response.json(
              { error: "Could not load scheduled connections." },
              { status: 500, headers: { "Cache-Control": "no-store" } },
            );
          }

          const slot = Math.floor(Date.now() / SCHEDULE_WINDOW_MS);
          let succeeded = 0;
          let failed = 0;
          const queue = [...(connections ?? [])];
          const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
            while (queue.length) {
              const connection = queue.shift();
              if (!connection) return;
              try {
                await integrationService.syncConnection({
                  orgId: connection.org_id,
                  connectionId: connection.id,
                  actorId: null,
                  requestId: `autopilot:${connection.id}:${slot}`,
                  trigger: "schedule",
                });
                succeeded++;
              } catch {
                // The sync service records the provider error. Do not leak provider
                // response bodies or credential-adjacent messages to the scheduler.
                failed++;
              }
            }
          });
          await Promise.all(workers);
          return Response.json(
            {
              ok: failed === 0,
              checked: connections?.length ?? 0,
              succeeded,
              failed,
              capped: (connections?.length ?? 0) === PAGE_SIZE,
              next_interval_minutes: 15,
            },
            { headers: { "Cache-Control": "no-store" } },
          );
        } finally {
          integrationService.bindIntegrationsClient(null);
        }
      },
    },
  },
});
