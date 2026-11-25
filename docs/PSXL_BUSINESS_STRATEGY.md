# PSXL: Pakistan-First Brokerage Intelligence Platform

**Product thesis:** PSXL is the operational intelligence layer between brokerage records, investor portfolios, and financial decisions. It turns fragmented broker data into verified, explainable, actionable financial operations.

**Initial market:** Pakistan Stock Exchange ecosystem.  
**Initial customer:** Licensed securities brokers and their operations / compliance teams.  
**Secondary customer:** Self-directed investors who need a consolidated, evidence-backed financial record.  
**Not the initial business:** A broker, custodian, exchange, execution venue, or unlicensed investment-advice service.

## 1. Why this market, why now

SECP reported on 4 November 2026 that PSX investor accounts reached 681,965 by October 2026, up 47.3% from the beginning of the year, with 218,894 net new investors. Investors aged 18–30 represented 54.6% of October's new individual accounts. This is a strong demand signal, not proof of willingness to pay.

PSX and SECP are actively digitising onboarding and market access. PSX's online-only broker framework makes digital operations increasingly relevant, while also making clear that brokerage itself is a regulated activity.

The opportunity is not to build another charting terminal. It is to remove costly manual work and improve the reliability of financial records for brokers and investors.

## 2. Positioning

**Category:** Brokerage Operations Intelligence (BOI).

**One-line promise:** Every trade, fee, statement and exception — reconciled, explained and audit-ready.

**For brokers:** Reduce manual back-office reconciliation, shorten exception resolution, improve client reporting, and maintain a traceable evidence trail.

**For investors:** Bring multi-broker records together, understand true costs and realised gains, and keep a verified record ready for tax and review.

Avoid promises of guaranteed returns, predictive certainty, automatic profit, or AI-generated investment calls.

## 3. Product architecture: three connected surfaces

### A. PSXL Broker Desk — the revenue wedge

1. **Statement ingestion:** PDF, image, CSV and XLSX intake; broker-specific parsers; source document retained.
2. **Normalisation:** Map different broker formats to a canonical trade, cash movement, fee, tax and corporate-action schema.
3. **Reconciliation:** Match broker contract notes, client ledger, cash movements and available settlement records. Use exact IDs first, then transparent fuzzy matching with review.
4. **Exception workbench:** Assign, prioritise, comment, resolve and track duplicate trades, missing fills, fee differences, WHT differences, unmatched cash and stale records.
5. **Client reporting:** Generate statement-backed summaries and branded reports with source references.
6. **Audit & controls:** Role-based access, immutable event history, approvals for material corrections, exportable evidence bundles.
7. **Operations analytics:** Exception ageing, break rate, time-to-resolution, ingestion success, unresolved exposure and workload by team.

The broker desk must support a human review queue. AI may extract, classify and explain; deterministic code decides arithmetic, matching thresholds, permissions and state changes.

### B. PSXL Investor — distribution and retention

- Consolidated multi-broker ledger.
- Verified transaction history and document vault.
- Cost basis, realised gains and cash-flow views.
- Fee and withholding-tax breakdowns.
- Corporate-action and dividend record tracking.
- Tax-year workpapers and exports, with rules versioned by tax year.
- Urdu/English financial education and plain-language explanations.
- Clear distinction between recorded values, market prices, estimates and missing data.

### C. PSXL Intelligence — differentiation

A grounded analyst that answers questions from the user's actual records and licensed/contracted market data:
- “Why does my broker statement differ from my ledger?”
- “Which fees changed this month?”
- “Which records need my attention before month-end?”
- “Show my realised gains by symbol and tax year.”
- “Compare my portfolio concentration with a benchmark.”

Every answer should expose data freshness, source, calculation method, confidence and missing inputs. The model must never invent quotes or financial figures.

## 4. The product must be a real system, not a chatbot wrapper

The primary workflow is not chat. It is:

**Connect / Upload → Parse → Validate → Reconcile → Review → Approve → Publish → Monitor.**

Chat is a command and explanation interface layered over real product workflows.

Core domain services:
- Document ingestion and malware/type/size validation.
- Parsing jobs with idempotency keys and retry-safe state transitions.
- Canonical transaction and cash-ledger model.
- Deterministic reconciliation engine with explainable match evidence.
- Versioned tax rules and deterministic calculations.
- Market-data adapter with source, timestamp, exchange, currency and entitlement metadata.
- Event-driven notification and exception queue.
- Tenant-aware permissions and audit events.
- Export/report generation from persisted, verified data.

Required statuses for ingestion: uploaded, queued, processing, needs_review, reconciled, posted, failed, retryable. Never silently mark a partially parsed statement complete.

## 5. AI reliability requirements

A user greeting must not require an external model. General help and basic navigation should have deterministic fallbacks.

For model-backed work:
- Provider adapters with independent health, latency, timeout and quota state.
- Classify 401/403 as configuration/access failures; 429 as rate-limited; 5xx/timeouts as transient; malformed output as model/output failure.
- Exponential backoff with jitter and respect Retry-After.
- Circuit breaker per provider/model, with cooldown and controlled half-open probes.
- Fail over only before a side effect or visible partial response. Never replay a tool-using request after a write may have happened.
- Persist the user request and job status before long-running work; allow retry/resume without duplicating records.
- Do not charge customer AI credits for failed provider attempts. Record actual successful usage separately from infrastructure attempts.
- Do not expose raw provider errors or API details to users.
- Track request ID, provider/model, latency, attempts, failure class and token/cost metadata server-side.

Critical invariant: provider failure must never corrupt or duplicate the ledger.

## 6. Pakistan-first data and compliance posture

- Begin with PSX-listed equities and broker statement formats actually obtained from pilot brokers.
- Store PKR precisely using decimal-safe arithmetic; do not use floating point for money.
- Model trade date, settlement date, exchange timezone, symbol, ISIN where available, broker reference, fees, taxes and corporate actions separately.
- Version all tax rules by effective date and tax year. Have a qualified Pakistani tax professional validate rules before production tax filing claims.
- Use official PSX/SECP/NCCPL/CDC sources or licensed data vendors. Respect redistribution and display rights; do not scrape or repackage restricted feeds.
- Obtain written broker/customer consent and data-processing terms before importing production financial records.
- Encrypt credentials and sensitive documents; apply strict tenant isolation, least privilege, access logs, retention/deletion policy, backups and incident response.
- Do not offer execution, custody, brokerage, personalised investment advice or regulated services without the required authorisations and legal review.

## 7. Business model and pricing hypotheses

Validate willingness to pay before fixing public prices.

**Broker SaaS (primary):**
- Pilot: fixed-scope paid implementation with one broker, limited statement formats and agreed success metrics.
- Team: monthly platform fee + active account / document-volume band.
- Enterprise: annual contract, SSO, custom integrations, dedicated support, retention controls and SLA.

**Investor (secondary):**
- Free: manual uploads, basic consolidated ledger and limited history.
- Plus: multi-broker automation, advanced analytics, tax workpapers and document retention.
- Do not monetise by selling personal financial data or undisclosed lead referrals.

Potential services revenue: broker-format onboarding, migration, integration and custom reporting. Keep bespoke work from becoming the core product.

## 8. Go-to-market: first 90 days

### Days 1–15: prove the pain
- Interview 10–15 broker operations/compliance staff and 20 active investors.
- Obtain anonymised sample contract notes/statements from at least two brokers with permission.
- Measure current manual reconciliation time, exception rate, common break types and report turnaround.
- Identify the actual buyer, budget owner, security requirements and procurement path.
- Do not build more modules until the top three repeated pains are verified.

### Days 16–30: concierge pilot
- Build ingestion for the two most common real statement formats discovered.
- Deliver a working reconciliation queue and evidence-linked exception report.
- Run historical statements in parallel with the broker's existing process.
- Human-verify every match and calculation.
- Agree on baseline and success criteria before pilot begins.

### Days 31–60: production-grade core
- Add idempotent jobs, retries, role permissions, audit logs, monitoring and exports.
- Add broker-specific parser regression fixtures.
- Add operational dashboard: processed documents, parse accuracy, auto-match rate, unresolved breaks and time-to-resolution.
- Complete security and legal review before any live customer data rollout.

### Days 61–90: convert and repeat
- Convert the first pilot into a paid annual or monthly contract if ROI is demonstrated.
- Secure a second broker design partner.
- Publish a case study only with written permission and verified metrics.
- Build a repeatable onboarding playbook and a standard integration contract.

## 9. Metrics that prove a business

**Reliability:** successful ingestion %, provider availability, job retry success, duplicate-write rate, data-loss incidents.

**Accuracy:** field-level extraction precision/recall, auto-match precision, false-positive rate, human correction rate. Optimise precision before auto-posting.

**Customer value:** minutes saved per 1,000 trades, exception resolution time, month-end close time, report turnaround.

**Commercial:** paid pilots, pilot-to-paid conversion, recurring revenue, gross margin, customer acquisition cost, churn, expansion revenue and implementation time.

Do not report vanity counts such as AI messages or total uploaded files as proof of customer value.

## 10. Competitive moat

The moat is not the LLM. Models are replaceable.

Build defensibility from:
1. A growing library of broker-specific document formats and validated parsers.
2. High-quality reconciliation rules and edge-case fixtures.
3. A canonical financial data model with traceable evidence.
4. Embedded workflows inside broker operations.
5. Reliable, versioned Pakistan tax and corporate-action handling.
6. Integrations, trust, auditability and switching costs earned through customer value.

Never train on customer financial documents without explicit, informed permission.

## 11. Product roadmap and gates

**P0 — Trustworthy core:** deterministic ledger, statement ingestion, review queue, reconciliation, audit trail, export, robust AI fallback.

**P1 — Broker pilot:** two real broker formats, multi-user workflow, exception analytics, client-ready reports, permissions and operational monitoring.

**P2 — Market intelligence:** contracted market data, corporate actions, portfolio valuation with freshness labels, benchmark analytics.

**P3 — Scale:** broker integrations, enterprise controls, partner APIs, more exchanges only after PSX economics and retention are proven.

**Gate to expand:** do not add NSE/global exchanges or algorithmic recommendations until PSX product-market fit, reliable data rights and compliance review are established.

## 12. What to stop doing

- Stop adding dashboard cards without a user workflow behind them.
- Stop presenting demo or cost-basis proxies as live portfolio value.
- Stop claiming integrations are connected unless a live test and sync succeeded.
- Stop relying on chat as the only way to use the product.
- Stop letting AI make authoritative tax, fee, balance or reconciliation calculations.
- Stop expanding to many exchanges before one market has paying customers.
- Stop treating a provider fallback list as a reliability strategy without monitoring, retry budgets and safe side-effect rules.

## 13. Official market and regulatory references

- SECP, 4 November 2026: PSX investor base growth to 681,965 by October 2026. https://www.secp.gov.pk/wp-content/uploads/2026/11/november-4-.pdf
- PSX Online Only Broker framework and requirements: https://www.psx.com.pk/psx/online-only-broker
- SECP securities broker licensing overview: https://www.secp.gov.pk/licensing/capital-markets/agents-and-brokers/
- PSX Investor Awareness Guide: https://www.psx.com.pk/psx/resources-and-tools/investors/investor-awareness-guide
- PSX Annual Report 2025: https://www.psx.com.pk/psx/themes/psx/uploads/Annual-Report-2025.pdf

*This is a product and commercial strategy, not legal, tax or investment advice. Regulatory interpretation and tax logic require qualified local review.*
