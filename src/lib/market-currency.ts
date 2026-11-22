// ─── Global exchange directory ──────────────────────────────────────────────
// Exchange recognition and currency metadata are not tax-rule support.
// Tax residence must be collected separately from listing venue.
// Codes include common vendor symbols and ISO 10383 MIC identifiers.

export interface ExchangeInfo {
  code: string;
  name: string;
  country: string;
  currency: string;
}

const EXCHANGES: ExchangeInfo[] = [
  { code: "PSX", name: "Pakistan Stock Exchange", country: "Pakistan", currency: "PKR" },
  { code: "NSE", name: "National Stock Exchange of India", country: "India", currency: "INR" },
  { code: "BSE", name: "BSE India", country: "India", currency: "INR" },
  { code: "NYSE", name: "New York Stock Exchange", country: "United States", currency: "USD" },
  { code: "NASDAQ", name: "Nasdaq", country: "United States", currency: "USD" },
  { code: "AMEX", name: "NYSE American", country: "United States", currency: "USD" },
  { code: "CBOE", name: "Cboe Global Markets", country: "United States", currency: "USD" },
  { code: "OTC", name: "US Over-the-Counter Markets", country: "United States", currency: "USD" },
  { code: "LSE", name: "London Stock Exchange", country: "United Kingdom", currency: "GBP" },
  { code: "AIM", name: "London Stock Exchange AIM", country: "United Kingdom", currency: "GBP" },
  { code: "TSX", name: "Toronto Stock Exchange", country: "Canada", currency: "CAD" },
  { code: "TSXV", name: "TSX Venture Exchange", country: "Canada", currency: "CAD" },
  { code: "CSE", name: "Canadian Securities Exchange", country: "Canada", currency: "CAD" },
  { code: "ASX", name: "Australian Securities Exchange", country: "Australia", currency: "AUD" },
  { code: "NZX", name: "New Zealand Exchange", country: "New Zealand", currency: "NZD" },
  { code: "HKEX", name: "Hong Kong Exchanges and Clearing", country: "Hong Kong", currency: "HKD" },
  { code: "TSE", name: "Tokyo Stock Exchange", country: "Japan", currency: "JPY" },
  { code: "JPX", name: "Japan Exchange Group", country: "Japan", currency: "JPY" },
  { code: "OSE", name: "Osaka Exchange", country: "Japan", currency: "JPY" },
  { code: "KRX", name: "Korea Exchange", country: "South Korea", currency: "KRW" },
  { code: "KOSDAQ", name: "KOSDAQ", country: "South Korea", currency: "KRW" },
  { code: "SGX", name: "Singapore Exchange", country: "Singapore", currency: "SGD" },
  { code: "SIX", name: "SIX Swiss Exchange", country: "Switzerland", currency: "CHF" },
  { code: "SWX", name: "SIX Swiss Exchange", country: "Switzerland", currency: "CHF" },
  { code: "BX", name: "BX Swiss Exchange", country: "Switzerland", currency: "CHF" },
  { code: "XETRA", name: "Deutsche Börse Xetra", country: "Germany", currency: "EUR" },
  { code: "XETR", name: "Deutsche Börse Xetra", country: "Germany", currency: "EUR" },
  { code: "FRA", name: "Frankfurt Stock Exchange", country: "Germany", currency: "EUR" },
  { code: "ETR", name: "Deutsche Börse Xetra", country: "Germany", currency: "EUR" },
  { code: "EURONEXT", name: "Euronext", country: "Multi-country Europe", currency: "EUR" },
  { code: "EPA", name: "Euronext Paris", country: "France", currency: "EUR" },
  { code: "AMS", name: "Euronext Amsterdam", country: "Netherlands", currency: "EUR" },
  { code: "EBR", name: "Euronext Brussels", country: "Belgium", currency: "EUR" },
  { code: "ELI", name: "Euronext Lisbon", country: "Portugal", currency: "EUR" },
  { code: "BIT", name: "Borsa Italiana", country: "Italy", currency: "EUR" },
  { code: "BME", name: "Bolsa de Madrid", country: "Spain", currency: "EUR" },
  { code: "VIE", name: "Vienna Stock Exchange", country: "Austria", currency: "EUR" },
  { code: "WSE", name: "Warsaw Stock Exchange", country: "Poland", currency: "PLN" },
  { code: "STO", name: "Nasdaq Stockholm", country: "Sweden", currency: "SEK" },
  { code: "OSL", name: "Oslo Børs", country: "Norway", currency: "NOK" },
  { code: "CPH", name: "Nasdaq Copenhagen", country: "Denmark", currency: "DKK" },
  { code: "HEL", name: "Nasdaq Helsinki", country: "Finland", currency: "EUR" },
  { code: "ATHEX", name: "Athens Stock Exchange", country: "Greece", currency: "EUR" },
  { code: "PRA", name: "Prague Stock Exchange", country: "Czechia", currency: "CZK" },
  { code: "BUD", name: "Budapest Stock Exchange", country: "Hungary", currency: "HUF" },
  { code: "B3", name: "B3 Brasil Bolsa Balcão", country: "Brazil", currency: "BRL" },
  { code: "BMV", name: "Bolsa Mexicana de Valores", country: "Mexico", currency: "MXN" },
  { code: "BCBA", name: "Buenos Aires Stock Exchange", country: "Argentina", currency: "ARS" },
  { code: "SSE", name: "Shanghai Stock Exchange", country: "China", currency: "CNY" },
  { code: "SZSE", name: "Shenzhen Stock Exchange", country: "China", currency: "CNY" },
  { code: "TWSE", name: "Taiwan Stock Exchange", country: "Taiwan", currency: "TWD" },
  { code: "TPEX", name: "Taipei Exchange", country: "Taiwan", currency: "TWD" },
  { code: "IDX", name: "Indonesia Stock Exchange", country: "Indonesia", currency: "IDR" },
  { code: "MYX", name: "Bursa Malaysia", country: "Malaysia", currency: "MYR" },
  { code: "SET", name: "Stock Exchange of Thailand", country: "Thailand", currency: "THB" },
  { code: "HOSE", name: "Ho Chi Minh Stock Exchange", country: "Vietnam", currency: "VND" },
  { code: "HNX", name: "Hanoi Stock Exchange", country: "Vietnam", currency: "VND" },
  { code: "PSE", name: "Philippine Stock Exchange", country: "Philippines", currency: "PHP" },
  { code: "CSE", name: "Colombo Stock Exchange", country: "Sri Lanka", currency: "LKR" },
  { code: "DSE", name: "Dhaka Stock Exchange", country: "Bangladesh", currency: "BDT" },
  { code: "TADAWUL", name: "Saudi Exchange", country: "Saudi Arabia", currency: "SAR" },
  { code: "ADX", name: "Abu Dhabi Securities Exchange", country: "United Arab Emirates", currency: "AED" },
  { code: "DFM", name: "Dubai Financial Market", country: "United Arab Emirates", currency: "AED" },
  { code: "QSE", name: "Qatar Stock Exchange", country: "Qatar", currency: "QAR" },
  { code: "BIST", name: "Borsa Istanbul", country: "Türkiye", currency: "TRY" },
  { code: "TASE", name: "Tel Aviv Stock Exchange", country: "Israel", currency: "ILS" },
  { code: "JSE", name: "Johannesburg Stock Exchange", country: "South Africa", currency: "ZAR" },
  { code: "NGX", name: "Nigerian Exchange", country: "Nigeria", currency: "NGN" },
  { code: "EGX", name: "Egyptian Exchange", country: "Egypt", currency: "EGP" },
  { code: "NSEKE", name: "Nairobi Securities Exchange", country: "Kenya", currency: "KES" },
  { code: "KSE", name: "Kuwait Boursa", country: "Kuwait", currency: "KWD" },
];

const EXCHANGE_CURRENCY: Record<string, string> = {};
const EXCHANGE_BY_CODE: Record<string, ExchangeInfo> = {};
for (const exchange of EXCHANGES) {
  EXCHANGE_CURRENCY[exchange.code] = exchange.currency;
  EXCHANGE_BY_CODE[exchange.code] = exchange;
}

// Common broker/vendor aliases and ISO 10383 MICs.
// Do not use ambiguous aliases such as TSE (used by multiple countries) as an alias
// for a different exchange; transaction imports should prefer the canonical code.
const ALIASES: Record<string, string> = {
  KSE100: "PSX",
  KARACHI: "PSX",
  XBOM: "BSE",
  XNSE: "NSE",
  XNYS: "NYSE",
  XNAS: "NASDAQ",
  XLON: "LSE",
  XTSE: "TSX",
  XTSX: "TSXV",
  XASX: "ASX",
  XHKG: "HKEX",
  XTKS: "TSE",
  XJPX: "JPX",
  XKRX: "KRX",
  XSES: "SGX",
  XSWX: "SIX",
  XETR: "XETRA",
  XFRA: "FRA",
  XPAR: "EPA",
  XAMS: "AMS",
  XBRU: "EBR",
  XLIS: "ELI",
  XMIL: "BIT",
  XMAD: "BME",
  XWBO: "VIE",
  XWAR: "WSE",
  XSTO: "STO",
  XOSL: "OSL",
  XCSE: "CPH",
  XHEL: "HEL",
  BVMF: "B3",
  XSHE: "SZSE",
  XSHG: "SSE",
  XTAI: "TWSE",
  XTAE: "TASE",
  XJSE: "JSE",
  XSAU: "TADAWUL",
};

export const SUPPORTED_EXCHANGES = EXCHANGES;

export function exchangeInfo(exchange: string | null | undefined): ExchangeInfo | undefined {
  const code = (exchange ?? "").trim().toUpperCase();
  const canonical = ALIASES[code] ?? code;
  return EXCHANGE_BY_CODE[canonical];
}

export function currencyForExchange(exchange: string | null | undefined): string {
  return exchangeInfo(exchange)?.currency ?? "USD";
}
