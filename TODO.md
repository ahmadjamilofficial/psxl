# PSXL outcomes

## Source connections and live imports

- [x] Users can connect supported bank, brokerage, exchange, wallet, ledger, profile, CSV, spreadsheet, PDF, and image sources through the existing catalog and integration flow.
- [x] Provider credentials are verified server-side, encrypted before persistence, and never returned to the browser.
- [x] A connection is only shown as connected after a genuine provider test; verification and source sync are shown as separate states.
- [x] Sync persists normalized provider accounts and transactions with deterministic deduplication and reports failures truthfully.

## Canonical ledger projection

- [x] Live trade-like imports are projected into canonical `transactions` rows used by Overview, tax, reconciliation, and ledger screens.
- [x] Corresponding `ledger_entries` are posted for imported BUY, SELL, and DIV rows.
- [x] Canonical rows preserve provider, connection, external transaction, and source-reference provenance.
- [x] Retries are insert-only and idempotent through deterministic provider connection keys and canonical `ref_id` values.
- [ ] Add explicit canonical handling for cash, fee, transfer, and other non-trade provider rows only after their ledger semantics and idempotency rules are defined.

## Dashboard correctness and freshness

- [x] Opening `/app/overview` does not interpret profile/org hydration or a disabled query as an empty ledger.
- [x] The Overview renders its empty state only after the first organization-scoped canonical transaction query has completed.
- [x] Integration sync invalidates canonical transactions, ledger entries, reconciliation flags, portfolio summaries, financial events, and financial insights.
- [ ] Add a durable freshness/status panel that shows the last successful sync and the next scheduled run for each source.

## Autonomous agent experience

- [x] Existing agent activity, review, confidence, evidence, and reversible-action components remain visible product surfaces rather than backend-only behavior.
- [x] High-confidence matching and monitoring can be automated while low-confidence or material decisions remain reviewable.
- [x] Homepage positioning explains that agents do the busywork while the user keeps final control.
- [ ] Complete production scheduling and retry configuration for background sync/autopilot per deployment environment, with visible failure state when secrets or schedules are missing.

## Homepage and user traction

- [x] Homepage messaging leads with the focused source-to-ledger reconciliation wedge instead of generic AI finance claims.
- [x] Homepage communicates Connect → Verify → Sync → Review → Post → Monitor with source attribution, freshness, and reversibility.
- [x] Dashboard and integrations copy explains what is live, what needs review, and what was actually posted.
- [x] Founder guidance and its source URLs are saved in `docs/founder-guidance.md`.
- [ ] Validate the first-run funnel with real users and use observed connection failures, time-to-first-ledger, review rate, and retained weekly usage to prioritize the next provider and workflow.

## Validation and delivery

- [x] Production build succeeds.
- [ ] Resolve or separately track the repository-wide pre-existing TypeScript and lint baseline; the current repository still reports hundreds of unrelated generated-type, route-manifest, and strictness diagnostics.
- [ ] Run the corrected Vitest command and add focused integration projection/readiness tests where the existing test harness supports them.
- [ ] Fetch/rebase `origin/main`, commit the intended PSXL changes, and push the validated result to `origin/main`.
