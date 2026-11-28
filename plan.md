# PSXL scalable AI-operations plan

## Product direction

PSXL wins a narrow, painful workflow first: turning fragmented broker, bank, wallet, and document records into a verified, explainable ledger for active traders and broker-operations teams. The product workflow is Connect → Verify → Sync → Review → Post → Monitor. Autonomous agents handle extraction, matching, anomaly detection, support triage, maintenance, onboarding, growth drafts, and recurring reporting, while deterministic code performs ledger and tax arithmetic and material or low-confidence decisions remain reviewable.

The homepage and dashboard emphasize source attribution, freshness, confidence, reversible actions, and measurable time saved. They do not promise investment returns, universal provider coverage, or unsupervised financial decisions.

## AI operations operating model

The existing `agent_jobs` queue remains the execution backbone. Migration `006_ai_operations_control_plane.sql` adds a durable catalog of nine bounded roles plus organization-scoped configuration: Ingestion & Sync, Reconciliation, Exception Triage, Compliance & Audit, Customer Support, Reliability & Maintenance, Customer Success & Onboarding, Marketing & Growth, and Founder Metrics & Reporting.

Each role has a narrow mission, allowed tool families, trigger sources, default approval tier, success metrics, and escalation path. `AUTO` is limited to bounded and reversible work; `NOTIFY` informs an operator; `REVIEW` drafts or proposes material changes; `STOP` requires owner/admin approval. Queue retries, dead-letter state, audit history, tenant RLS, and heartbeat wake-up are reused rather than duplicated.

The `/app/operations` control center makes the operating model visible: role roster, policy tiers, triggers, escalation language, 30-day queue health, failed/dead-letter pressure, and pending approvals. Activity Feed and Review Inbox remain the detailed evidence and decision surfaces.

## Implementation approach

The integration API authenticates the caller and verifies organization membership. The server-side integration service persists provider-derived records with the trusted server client because normalized integration tables intentionally do not expose broad authenticated INSERT policies. Provider rows remain the durable ingestion layer; deterministic provider and connection keys make retries idempotent.

After normalized persistence, trade-like records are projected into canonical `transactions` and paired `ledger_entries`. Each canonical row keeps provider metadata and a deterministic `ref_id`, so Overview, tax, reconciliation, and ledger views use the same source-backed records. Non-trade provider rows remain normalized until the canonical schema supports their semantics without inventing ledger meaning.

React Query views distinguish authentication/profile hydration from a completed empty query. Overview waits for the first organization-scoped transaction fetch before rendering zero-state content. Integration syncs invalidate transactions, ledger entries, reconciliation flags, portfolio summaries, events, and insights so the dashboard reflects a successful import without a route round trip.

## Production scaling gates

1. Apply and verify migrations 001–006 in every deployment environment; provision role configs for newly created organizations.
2. Connect each role to an explicit runner handler with structured inputs/outputs, bounded retries/concurrency, model configuration from the live model catalog, and programmatic validation. No role may invent ledger arithmetic.
3. Add event-to-role routing and operation-level evidence references without bypassing `agent_jobs`, approvals, or audit logging.
4. Add durable source freshness/next-run status and provider circuit-breaker metrics to the operations view.
5. Instrument the wedge metrics: time-to-first-ledger, match precision, exception resolution time, ingestion reliability, activation, weekly retention, qualified conversion, and support resolution.
6. Validate the first-run funnel with real users; prioritize observed connection failures and time-to-value over broad provider count.

## Project structure

- `src/routes/app.operations.tsx`: visible cross-functional AI operations control center.
- `src/lib/ai-operations.ts`: tenant-scoped operations catalog and queue health query.
- `src/lib/agent-queue.ts`: durable queue, approvals, retries, and worker wake-up.
- `src/lib/data-hooks.ts`: organization-scoped React Query hooks and invalidation behavior.
- `src/lib/integrations/`: provider contracts, catalog, adapters, encryption, registry, and lifecycle service.
- `src/components/intelligence/` and `src/components/agent/`: visible agent activity, evidence, review, and explanation surfaces.
- `supabase/migrations-autonomous/`: autonomous-agent persistence, policies, functions, schedules, storage, and operations control plane.
- `docs/`: founder guidance and product/architecture context.
