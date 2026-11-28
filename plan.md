# PSXL production-readiness plan

## Product direction

PSXL should win a narrow, painful workflow first: turning fragmented broker, bank, wallet, and document records into a verified, explainable ledger for active traders and broker-operations teams. The product workflow is Connect → Verify → Sync → Review → Post → Monitor. Autonomous agents handle extraction, matching, anomaly detection, and recurring monitoring, while deterministic code performs ledger and tax arithmetic and material or low-confidence decisions remain reviewable.

The homepage and dashboard emphasize source attribution, freshness, confidence, reversible actions, and measurable time saved. They do not promise investment returns, universal provider coverage, or unsupervised financial decisions. Traction should come from making the first supported workflow excellent for users with messy records today.

## Implementation approach

The integration API authenticates the caller and verifies organization membership. The server-side integration service persists provider-derived records with the trusted server client because normalized integration tables intentionally do not expose broad authenticated INSERT policies. Provider rows remain the durable ingestion layer; deterministic provider and connection keys make retries idempotent.

After normalized persistence, trade-like records are projected into canonical `transactions` and paired `ledger_entries`. Each canonical row keeps provider metadata and a deterministic `ref_id`, so Overview, tax, reconciliation, and ledger views use the same source-backed records. Non-trade provider rows remain normalized until the canonical schema supports their semantics without inventing ledger meaning.

React Query views distinguish authentication/profile hydration from a completed empty query. Overview waits for the first organization-scoped transaction fetch before rendering zero-state content. Integration syncs invalidate transactions, ledger entries, reconciliation flags, portfolio summaries, events, and insights so the dashboard reflects a successful import without a route round trip.

Agent workflows are visible through activity, review inbox, confidence, evidence, and reversible-action components. Autonomous work is bounded by provider permissions, idempotency, deterministic calculations, audit logging, and human review for uncertain changes. Background scheduling reports freshness and failure state when it is not configured.

## Project structure

- `src/routes/`: public acquisition pages, authenticated dashboard routes, and integration actions.
- `src/lib/integrations/`: provider contracts, catalog, adapters, encryption, registry, and lifecycle service.
- `src/lib/data-hooks.ts`: organization-scoped React Query hooks and invalidation behavior.
- `src/lib/financial-intelligence-hooks.ts`: derived health, priorities, events, insights, and portfolio summaries.
- `src/components/intelligence/` and `src/components/agent/`: visible agent activity, evidence, review, and explanation surfaces.
- `supabase/migrations/`: source connections, normalized ingestion, canonical ledger, realtime, and autonomous-agent persistence.
- `docs/`: founder guidance and product/architecture context.

## Design direction

Three directions were considered: “Audit-room control surface” (0.06), “Quiet financial operations desk” (0.08), and “Signal console” (0.07). PSXL uses **Audit-room control surface**.

The movement is restrained editorial operations software: calm sheets, dense but legible evidence, and clear status language. Core principles are provenance first, high information density without visual noise, visible agent state, and reversible action. The palette uses warm neutral surfaces with one ownable accent for verified flow, amber for review, and red only for blocked or failed states. The layout favors a wide working surface with a left-to-right workflow rather than generic centered marketing grids.

Signature elements are source chips with freshness timestamps, an agent activity rail with confidence states, and provenance links connecting source row → decision → canonical ledger row. Interactions show progress and consequences before completion. Animation is short and functional: skeletons during readiness and restrained transitions for agent state. Typography uses the existing heading/body system with tabular numerals for financial values. Brand voice is direct, calm, and evidence-led: “See exactly what entered your ledger” and “Agents do the busywork. You keep the final say.”

## Required production behavior

A connection is not presented as fully successful merely because credentials were accepted. Provider verification and source sync are separate states. A failed first persistence attempt remains visible with a retry path. Successful sync responses report normalized rows and canonical ledger rows posted. All derived dashboard views use organization-scoped live data and show loading state until the first fetch completes.
