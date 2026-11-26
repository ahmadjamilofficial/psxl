# PSXL Brokerage Pilot Readiness

## Positioning

PSXL is a brokerage operations and reconciliation workspace. It helps an operations team ingest statements, structure trade records, identify exceptions, route decisions to authorised staff, and retain traceable operational records.

PSXL is not a brokerage core, exchange gateway, order-management system, custodian, settlement bank, or regulatory filing service. Sales material must not imply that it replaces those systems.

## First paid use case

Start with one repeatable workflow: **daily broker statement reconciliation and exception management**.

A pilot brokerage provides controlled sample statements and its expected reconciliation rules. PSXL processes those files, extracts candidate records, compares them with the brokerage's designated source of truth, and gives operations staff a queue of differences to investigate. A human reviewer remains responsible for approving any posting or correction.

## Operating workflow

1. **Workspace setup** — identify the legal entity, team, venues, base currencies, roles, and retention requirements.
2. **Source registration** — record provider, account identifier, file format, timezone, currency, and delivery cadence.
3. **Statement intake** — upload through an authenticated workspace and retain original-file metadata.
4. **Extraction and normalisation** — map source columns to a canonical transaction model and preserve source row references and parser confidence.
5. **Validation** — check required fields, dates, numeric precision, currency, duplicate references, and account ownership.
6. **Reconciliation** — compare candidate records with the brokerage's designated source of truth; classify matched, unmatched, duplicate, and value-mismatch outcomes.
7. **Exception review** — assign an owner, capture a reason and evidence, and record disposition.
8. **Controlled posting** — only authorised staff may post accepted records; unresolved or rejected records must never silently enter the book.
9. **Close and export** — produce a batch summary, unresolved-exception report, and source-to-ledger evidence pack.
10. **Monitoring** — measure processing time, exception age, failure rate, and source freshness.

## Pilot acceptance criteria

Do not call a pilot successful until the brokerage signs off on these criteria:

- Representative anonymised samples from each in-scope source can be ingested repeatedly without corrupting existing records.
- Every extracted transaction can be traced to its original file and source row/page.
- Duplicate detection is deterministic and tested against repeated uploads.
- Amounts, fees, taxes, quantities, dates, and currencies reconcile within agreed tolerances.
- Unmatched and ambiguous records remain in review; no AI-generated value is silently posted.
- Operator, reviewer, and administrator permissions are tested with separate accounts.
- Cross-organisation access tests confirm one tenant cannot read or mutate another tenant's data.
- Failed uploads and parser errors are visible and recoverable, with no partial ledger postings.
- Audit exports identify actor, timestamp, source, action, entity, and disposition.
- Brokerage compliance, security, legal, and IT owners approve the pilot data flow.

## Production blockers

These are launch gates before live brokerage books or regulated production workloads:

1. **Server-side audit integrity** — canonical hash generation and complete chain verification on the server, with pagination, concurrency handling, and exportable verification evidence. The current UI must not claim cryptographic verification.
2. **Approval execution semantics** — separate recording an approval decision from executing the approved operation. Execution must be idempotent, permission-checked, and auditable. An approval-row status change alone must never imply that a financial change was applied.
3. **Role-based access control** — least-privilege operator, reviewer, approver, administrator, and auditor roles enforced in database policies and server endpoints, not only in the UI.
4. **Tenant isolation** — automated negative tests for reads, writes, storage, exports, realtime subscriptions, and background jobs across organisations.
5. **Data protection** — documented encryption, key management, secrets handling, backup/restore, retention, deletion, and incident response.
6. **Resilience** — idempotent jobs, retries/backoff, dead-letter visibility, rate limits, file-size limits, malware scanning, and service health alerts.
7. **Source adapters** — certify one adapter per pilot brokerage's actual statement/API format. Do not imply universal broker connectivity.
8. **Financial correctness** — golden tests for each supported venue, currency, precision, fee/tax convention, corporate action, and timezone.
9. **Independent assurance** — security review and jurisdiction-specific legal/regulatory review.

## Pilot scorecard

Record a baseline before deployment, then compare the same measures during the pilot:

| Measure | Definition |
|---|---|
| Statement processing time | Receipt to reviewed/closed batch |
| Manual touches per 1,000 rows | Human interventions required |
| Exception rate | Exceptions divided by extracted rows |
| False-positive rate | Exceptions dismissed as valid after review |
| Missed-error rate | Seeded known issues not detected |
| Duplicate prevention | Duplicate rows blocked before posting |
| Reconciliation completion | Share of batch resolved by agreed cutoff |
| Evidence completeness | Records with source lineage and disposition |

Set numeric targets with the brokerage after measuring its baseline. Never publish fabricated accuracy or savings claims.

## Commercial pricing proposal

The public website keeps the existing Individual Kelviq plans and separates brokerage sales from self-serve checkout. These prices are the current PSXL site configuration and must remain aligned with the published Kelviq plans:

| Individual plan | Monthly | Annual | Intended customer |
|---|---:|---:|---|
| Basic | $0 | $0 | Personal ledger entry and limited AI allowance |
| Standard | $9/month | $45/year | Active individual traders |
| Pro | $25/month | $90/year | High-volume individual traders |

The annual amounts are totals billed once per year (not monthly prices). The effective monthly equivalents are $3.75 for Standard and $7.50 for Pro. These annual discounts are unusually aggressive relative to monthly billing. Do not change live plan prices or migrate existing subscribers casually; validate willingness to pay and unit economics first, then publish a new Kelviq plan version or new identifiers with an explicit migration policy.

### Brokerage commercial model

Do not reuse Individual plan identifiers for a brokerage. Keep the Business product separate in Kelviq and keep the public site sales-led until PSXL has passed the relevant pilot acceptance and production gates.

| Commercial offer | Pricing approach | What is sold |
|---|---|---|
| Brokerage pilot | One-time scoped quote; initial internal anchor $2,500–$7,500 | 4–6 week evaluation of one entity, one operations team and one or two agreed statement formats |
| Brokerage Operations | Annual agreement, quoted after pilot | Recurring reconciliation operations, agreed monthly row volume, source adapters, reviewer workflow and support |
| Enterprise | Custom annual agreement | Multiple entities/teams, custom controls, dedicated deployment or integrations, security and service commitments |

The $2,500–$7,500 pilot figure is an internal negotiation anchor, not a published Kelviq checkout price. Do not publish the previous speculative $499/$1,500 monthly tiers until the product's supported volumes, integration cost, gross margin and production controls have been measured.

Price business plans primarily by monthly records processed, source integrations, legal entities, required controls, deployment model, and support commitment. Seat count should be a secondary factor. Define included transaction bands and overage pricing only after measuring infrastructure cost and pilot usage.

### Implementation and pilot fees

- Charge implementation separately from recurring software fees when source mapping, migration, or custom integrations are required.
- Quote enterprise implementation after technical discovery.
- A pilot should define one brokerage entity, one team, one or two source formats, anonymised historical samples, a limited live shadow period, agreed exception categories, weekly operations reviews, and a written acceptance report.
- Consider crediting part of the pilot fee toward an annual contract if the customer converts.

### Pricing rules

- Quote annual agreements for business and enterprise customers; monthly-equivalent pricing is only a comparison, not a monthly cancellation option unless contractually offered.
- Charge separately for custom integrations, data migration, on-premise/private-cloud deployment, and bespoke support.
- Never promise 24/7 support, an SLA, SSO, data residency, or a security certification until the capability and operational process exist.
- Set usage limits from observed cost and capacity, not guesses.
- Do not put enterprise pricing into automated checkout until billing, metering, entitlements, and overages are implemented.

## Brokerage demo

Use synthetic or anonymised data and demonstrate one complete case:

1. Upload a statement.
2. Show original source metadata and extracted rows.
3. Open a duplicate, fee mismatch, and missing trade.
4. Show the rule and source evidence behind each flag.
5. Assign and resolve an exception.
6. Show that reviewer decision is recorded separately from execution/posting.
7. Export a batch summary and exception evidence.
8. Show roles, source freshness, and operational status.

Never use real client PII or live account credentials in a sales demo.

## Sales discovery questions

- Which systems are the current sources of truth for trades, cash, positions, fees, and tax?
- Which files arrive daily, from whom, in what format, and at what cut-off?
- What is the current manual reconciliation process and how many staff-hours does it consume?
- Which exception types create the most operational risk or delay?
- Who may review, approve, post, reverse, and export records?
- What data may be processed in a vendor-hosted cloud and what must remain on-premise?
- What security questionnaire, DPA, retention, audit, and incident requirements must a vendor satisfy?
- What measurable result would justify a paid production contract?


## Kelviq commercial architecture (November 2026)

- Keep Individual Basic, Standard and Pro in the existing Individual Kelviq product. Their existing plan identifiers remain `free-plan`, `standard-plan` and `pro-plan`; do not repurpose these identifiers for brokerage customers.
- Keep the current Individual public prices aligned with the published Kelviq plan prices. The application must display the annual effective monthly equivalent correctly and must not claim market data is real-time where the provider may delay or omit an exchange.
- Create a separate Kelviq product for Brokerage Operations. Use a one-time Pilot plan for a scoped 4–6 week engagement, a recurring Business plan for contracted operations, and a sales-led Enterprise plan for bespoke deployment. Configure each plan's feature entitlements and usage limits in Kelviq.
- Do not expose a Business checkout until its own published product and plan identifiers are explicitly mapped in the application. An unknown Kelviq plan identifier must never fall through to Individual Standard.
- Kelviq's current webhook contract uses `webhook-id`, `webhook-timestamp`, and `webhook-signature`; signatures cover `id.timestamp.rawBody`. Events carry the resource in `data.object`, and plan identifiers are in `data.object.plan.identifier`. Test this against a signed sandbox event before accepting live payments.
- For enterprise sales, quote implementation separately from recurring software fees. Define included entities, source adapters, monthly processed rows, storage, support hours, response targets, security requirements and change requests in the order form.


### Recommended Kelviq catalogue identifiers (not yet created)

Use a separate Kelviq product with the following proposed identity:

- Product name: `PSXL Brokerage Operations`
- Product identifier: `psxl-brokerage-operations`
- Tax code: `saas_business`
- Pilot plan identifier: `brokerage-pilot` (one-time purchase)
- Business plan identifier: `brokerage-operations` (recurring annual agreement)
- Enterprise plan identifier: `brokerage-enterprise` (recurring annual, custom scope)

These are reserved recommendations, not live Kelviq IDs. The Kelviq API generates the product UUID when the product is created. Do not wire these plan identifiers into checkout or publish them until the plans, prices, feature entitlements and webhook mappings have been created and verified in the correct Kelviq environment. Keep the existing Individual product and its published plan identifiers unchanged.
