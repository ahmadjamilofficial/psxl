import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Link as LinkIcon, Search } from "lucide-react";
import { useState } from "react";
import { Panel, StatusPill } from "@/components/kit";
import { useAuth } from "@/lib/auth-context";
import { useAuditLog } from "@/lib/data-hooks";

export const Route = createFileRoute("/app/audit-trail")({
  component: AuditTrail,
});

function AuditTrail() {
  const { profile } = useAuth();
  const { data: auditLog = [], isLoading } = useAuditLog(profile?.org_id);
  const [search, setSearch] = useState("");
  const filtered = auditLog.filter((row) => {
    const q = search.toLowerCase();
    return (
      !q ||
      String(row.actor ?? "")
        .toLowerCase()
        .includes(q) ||
      String(row.action ?? "")
        .toLowerCase()
        .includes(q) ||
      String(row.entity_type ?? "")
        .toLowerCase()
        .includes(q) ||
      String(row.hash ?? "")
        .toLowerCase()
        .includes(q)
    );
  });

  const actionLabel = (action: string) =>
    action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const actionTone = (action: string): "ok" | "warn" | "bad" | "info" => {
    if (action.includes("compute") || action.includes("parse")) return "info";
    if (action.includes("flag")) return "warn";
    if (action.includes("delete")) return "bad";
    return "ok";
  };

  return (
    <div className="space-y-6 p-3 sm:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 style={{ fontFamily: "var(--font-heading)", fontSize: "1.5rem" }}>Audit Trail</h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--ink-2)" }}>
            Recorded operational events and stored hash references for traceability.
          </p>
        </div>
        <span className="rounded-md border px-3 py-2 text-xs font-medium" style={{ borderColor: "var(--hairline)", color: "var(--ink-2)" }}>
          Integrity check not available
        </span>
      </div>

      {/* Search */}
      <div
        className="flex items-center gap-2 rounded-2xl bg-surface px-4 py-3"
        style={{ border: "1px solid var(--hairline)" }}
      >
        <Search size={16} strokeWidth={1.75} style={{ color: "var(--ink-3)" }} />
        <input
          type="text"
          placeholder="Search actor, action, entity or hash…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 text-sm outline-none bg-transparent"
        />
      </div>

      {/* Log table */}
      <div
        className="overflow-x-auto rounded-2xl bg-surface"
        style={{ border: "1px solid var(--hairline)" }}
      >
        {isLoading ? (
          <div className="py-16 text-center">
            <p className="text-sm" style={{ color: "var(--ink-3)" }}>
              Loading audit log…
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr
                  style={{
                    borderBottom: "1px solid var(--hairline)",
                    background: "var(--color-login-bg)",
                  }}
                >
                  {["Timestamp", "Actor", "Action", "Entity", "Prev hash", "Hash"].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-semibold"
                      style={{ color: "var(--ink-2)" }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => (
                  <motion.tr
                    key={row.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.06 }}
                    style={{ borderBottom: "1px solid var(--hairline)" }}
                    className="ledger-row transition-colors"
                  >
                    <td className="tnum px-4 py-3 text-xs" style={{ color: "var(--ink-2)" }}>
                      {new Date(row.created_at).toLocaleString("en-PK", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </td>
                    <td className="px-4 py-3 text-sm">{row.actor}</td>
                    <td className="px-4 py-3">
                      <StatusPill tone={actionTone(row.action)}>
                        {actionLabel(row.action)}
                      </StatusPill>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: "var(--ink-2)" }}>
                      <span className="font-medium">{row.entity_type}</span> · {row.entity_id}
                    </td>
                    <td
                      className="tnum px-4 py-3 font-mono text-xs"
                      style={{ color: "var(--ink-3)" }}
                    >
                      {row.prev_hash}
                    </td>
                    <td className="tnum px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="font-mono text-xs"
                          style={{ color: "var(--color-accent)" }}
                        >
                          {row.hash}
                        </span>
                        <button
                          type="button"
                          className="opacity-50 hover:opacity-100"
                          aria-label="Copy hash"
                          onClick={() => navigator.clipboard?.writeText(row.hash)}
                        >
                          <LinkIcon size={12} strokeWidth={1.75} />
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!isLoading && filtered.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-sm" style={{ color: "var(--ink-3)" }}>
              {auditLog.length === 0
                ? "No audit log entries yet."
                : "No entries match your search."}
            </p>
          </div>
        )}
      </div>

      <Panel>
        <p className="mb-2 text-sm font-semibold">Audit integrity status</p>
        <p className="text-sm leading-relaxed" style={{ color: "var(--ink-2)" }}>
          This view displays stored event hashes and previous-hash references. It does not independently recompute or verify the complete chain. Treat these records as operational trace data, not as a tamper-proof audit certificate. Server-side verification and exportable evidence are required before regulated production use.
        </p>
      </Panel>
    </div>
  );
}
