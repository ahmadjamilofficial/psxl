import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type EcosystemSyncStatus = "connecting" | "live" | "offline";

const SYNC_TABLES = [
  "transactions",
  "reconciliation_flags",
  "documents",
  "agent_jobs",
  "agent_approvals",
  "broker_accounts",
  "audit_log",
  "connected_sources",
  "notifications",
  "tax_profiles",
] as const;

/**
 * One organisation-scoped realtime bridge for the whole app.
 * Database changes invalidate shared React Query caches so every mounted page
 * reads the same committed ledger and workflow state.
 */
export function useEcosystemSync(orgId: string | undefined) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<EcosystemSyncStatus>("connecting");

  useEffect(() => {
    if (!orgId) {
      setStatus("offline");
      return;
    }

    setStatus("connecting");
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const channel = supabase.channel(`psxl-ecosystem-${orgId}`);

    const refreshSharedData = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        const keys = [
          ["transactions", orgId],
          ["transactions_month", orgId],
          ["reconciliation_flags", orgId],
          ["documents", orgId],
          ["documents_month", orgId],
          ["agent_jobs", orgId],
          ["agent_approvals_pending", orgId],
          ["broker_connections", orgId],
          ["audit_log", orgId],
          ["connected_sources", orgId],
          ["notifications"],
          ["tax_profiles", orgId],
          ["overview", orgId],
          ["portfolio", orgId],
          ["financial_insights", orgId],
          ["financial_events", orgId],
          ["portfolio_summary", orgId],
        ];
        for (const queryKey of keys) {
          void queryClient.invalidateQueries({ queryKey });
        }
      }, 120);
    };

    for (const table of SYNC_TABLES) {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          filter: `org_id=eq.${orgId}`,
        },
        refreshSharedData,
      );
    }

    channel.subscribe((nextStatus) => {
      if (nextStatus === "SUBSCRIBED") setStatus("live");
      else if (nextStatus === "CHANNEL_ERROR" || nextStatus === "TIMED_OUT" || nextStatus === "CLOSED") setStatus("offline");
      else setStatus("connecting");
    });

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, [orgId, queryClient]);

  return status;
}
