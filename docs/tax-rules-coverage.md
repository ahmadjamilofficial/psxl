# PSXL tax rules coverage and research notes

**Research checked:** 22 November 2026  
**Purpose:** Prevent market/currency detection from being mistaken for a verified tax calculation. This is an engineering coverage note, not tax advice.

## Current implementation status

| Country / exchange | Market detection | Tax engine status | Notes |
|---|---|---|---|
| Pakistan / PSX | Detected from imported exchange codes | Legacy / requires correction | Current engine uses a single holding-period schedule and does not model acquisition-date bands or ATL status on both acquisition and disposal dates. |
| India / NSE | Detected from imported exchange codes | Partial / requires correction | Current engine applies 20% STCG and 12.5% LTCG but does not model Section 112A's annual ₹125,000 threshold, STT eligibility, security type, residency, surcharge or cess. |
| US / NYSE, NASDAQ, AMEX | Currency/exchange mapping only | Not implemented | Do not show a computed local tax rate. |
| UK / LSE | Currency/exchange mapping only | Not implemented | Do not show a computed local tax rate. |
| Canada / TSX, TSXV | Currency/exchange mapping only | Not implemented | Do not show a computed local tax rate. |
| Australia / ASX | Currency/exchange mapping only | Not implemented | Do not show a computed local tax rate. |
| Hong Kong / HKEX | Currency/exchange mapping only | Not implemented | Do not show a computed local tax rate. |
| Japan / TSE, JPX | Currency/exchange mapping only | Not implemented | Do not show a computed local tax rate. |
| South Korea / KRX | Currency/exchange mapping only | Not implemented | Do not show a computed local tax rate. |
| Singapore / SGX | Currency/exchange mapping only | Not implemented | Do not show a computed local tax rate. |
| Switzerland / SIX, SWX | Currency/exchange mapping only | Not implemented | Do not show a computed local tax rate. |
| Germany / XETRA, FRA; Euronext | Currency/exchange mapping only | Not implemented | Each taxpayer's residence and instrument classification still matter. |

**Important:** `currencyForExchange` knows several exchange currencies. That is not tax-rule support. Until a jurisdiction's rules are implemented and tested, PSXL should say that tax estimation is unavailable for that market rather than silently falling back to a generic percentage.

## Pakistan — PSX

The Income Tax Ordinance, 2001 (FBR copy amended to 20 February 2026) places listed-securities gains under section 37A and refers the rate to Division VII of Part I of the First Schedule. Finance Act 2024 replaced the Division VII table; Finance Act 2026's published summary retains the acquisition-date split.

Key implementation dimensions that the engine must capture:

- Acquisition date, not only sale date.
- Holding period from acquisition to disposal.
- For securities acquired 1 July 2022–30 June 2024: progressive rates by holding period (15%, 12.5%, 10%, 7.5%, 5%, 2.5%, 0% across the published bands).
- For securities acquired on or after 1 July 2024: 15% where the person is on the Active Taxpayers' List on **both** acquisition and disposal dates; otherwise the applicable individual/AOP or company rate, with a 15% minimum for individuals/AOPs.
- Older acquisition cohorts have separate treatment; PMEX futures have a separate 5% rate.
- Security type and taxpayer type must be explicit. Mutual funds, debt securities, companies, and exchange-traded derivatives must not be assumed to share the ordinary listed-share treatment.

The existing `psxCgtRate(holdingDays)` does not receive acquisition date or dated ATL status, so it cannot represent these rules faithfully. The single Filer/Non-Filer toggle is insufficient for post-1 July 2024 acquisitions.

Official / primary references:
- FBR Income Tax Ordinance, 2001 (amended to 20 February 2026): https://download1.fbr.gov.pk/Docs/2026226162211364IncomeTaxOrdinance2001-Amended-20.02.2026.pdf
- FBR Finance Acts index (including Finance Act 2026): https://fbr.gov.pk/Categ/Finance-Acts/620
- Finance Act 2024, Division VII amendment: https://download1.fbr.gov.pk/Docs/2024630146346801FinanceAct-2024.pdf
- Finance Act 2026 summary (cross-check of Division VII): https://assets.kpmg.com/content/dam/kpmgsites/pk/pdf/2026/07/A%20Brief%20of%20Finance%20Act%202026.pdf

## India — NSE

For listed equity subject to securities transaction tax (STT), the Income Tax Department's current guidance states:

- Section 111A short-term gains: 20% for transfers on or after 23 July 2024, subject to the statutory eligibility conditions.
- Section 112A long-term gains: 12.5% on aggregate eligible gains above ₹125,000 for transfers on or after 23 July 2024.
- Holding-period treatment, STT at acquisition/transfer, taxpayer residency, security type, other income, surcharge and cess can change the final liability. The ₹125,000 threshold is an annual aggregate threshold and cannot safely be applied independently to each trade or each imported statement.

The current PSXL NSE calculation does not model the Section 112A threshold or STT eligibility and therefore must be treated as a rough illustration until those inputs are collected.

Official references:
- Income Tax Department — tax on sale of shares: https://www.incometaxindia.gov.in/en/sale-of-shares
- Income Tax Department — capital gains overview and holding periods: https://www.incometaxindia.gov.in/w/capital-gain
- Finance Act 2026: https://www.incometaxindia.gov.in/documents/d/guest/finance-act-2026-pdf-1


## Expanded exchange directory (22 November 2026)

PSXL now has an exchange metadata/currency directory covering major venues across North America, Europe, Asia-Pacific, the Middle East, Africa and Latin America. This is **exchange recognition and currency metadata**, not a claim that every exchange has live quotes, broker import templates, or a verified tax calculator.

| Region | Exchanges / venues currently in directory |
|---|---|
| South Asia | PSX (Pakistan), NSE and BSE (India), Colombo Stock Exchange, Dhaka Stock Exchange |
| North America | NYSE, Nasdaq, NYSE American, Cboe, US OTC, TSX, TSX Venture, Canadian Securities Exchange |
| Europe | LSE, AIM, Xetra, Frankfurt, Euronext, Borsa Italiana, BME, Vienna, Warsaw, Nasdaq Nordic venues, Oslo, Prague, Budapest, Athens |
| East Asia | HKEX, Tokyo Stock Exchange / JPX, Osaka Exchange, Korea Exchange / KOSDAQ, Shanghai, Shenzhen, Taiwan Stock Exchange, Taipei Exchange |
| Southeast Asia | SGX, Indonesia Stock Exchange, Bursa Malaysia, Stock Exchange of Thailand, Ho Chi Minh Stock Exchange, Hanoi Stock Exchange, Philippine Stock Exchange |
| Middle East | Saudi Exchange, Abu Dhabi Securities Exchange, Dubai Financial Market, Qatar Stock Exchange, Borsa Istanbul, Tel Aviv Stock Exchange, Kuwait Boursa |
| Africa | Johannesburg Stock Exchange, Nigerian Exchange, Egyptian Exchange, Nairobi Securities Exchange |
| Latin America | B3 Brazil, Bolsa Mexicana de Valores, Buenos Aires Stock Exchange |

The code also recognizes selected common ISO 10383 Market Identifier Codes (MICs) and vendor aliases. The exchange directory is in `src/lib/market-currency.ts`; tests are in `src/lib/market-currency.test.ts`.

**Important limitations:** A recognized code currently lets PSXL identify a venue, its country label and a default trading currency. It does not mean that the market's securities master, live market data, broker statement parser, corporate-action handling, FX conversion, or local tax legislation has been integrated. Unknown codes still need review; a USD fallback is a display fallback only and must not be interpreted as evidence that an unknown instrument trades in USD.

## Product requirements before enabling another country

A country/market preset is only marked **verified** after the rule set has:

1. A primary government / tax-authority source and statutory section or schedule.
2. Effective-from and effective-to dates, with tax-year boundaries.
3. Tax residence, taxpayer type and relevant status inputs.
4. Asset/instrument coverage (listed shares, ETFs, funds, derivatives, bonds, etc.).
5. Acquisition-date and disposal-date logic, holding period, exemptions, thresholds, loss offsets, fees and withholding treatment where applicable.
6. Source URL, source publication/effective date, last-reviewed date, version and reviewer.
7. Deterministic unit tests for each rate band and boundary date, plus regression fixtures.
8. A visible user confirmation step and a plain-language assumptions/source summary.

## Recommended user flow

1. Detect exchange and currency from imported transactions.
2. Ask separately for **tax residence** and **taxpayer type/status**; never infer tax residence from exchange location or IP.
3. Preselect a verified rule set only when all required inputs are known.
4. Show a one-screen confirmation: country, market, tax year, taxpayer status, rule version, source and assumptions.
5. If a required input is missing or the rule set is not verified, label the result **Not available yet** or **Needs review**. Do not substitute a custom flat rate or a neighbouring country's tax rules.
6. Let the user override a setting in plain language, with a clear indication that it is a user override rather than an official default.

