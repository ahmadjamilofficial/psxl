const EXCHANGE_CURRENCY: Record<string, string> = {
  PSX: "PKR", KSE: "PKR", NSE: "INR", BSE: "INR",
  NYSE: "USD", NASDAQ: "USD", AMEX: "USD", LSE: "GBP", TSX: "CAD",
  TSXV: "CAD", ASX: "AUD", HKEX: "HKD", TSE: "JPY", JPX: "JPY",
  KRX: "KRW", SGX: "SGD", SIX: "CHF", SWX: "CHF",
  XETRA: "EUR", FRA: "EUR", EURONEXT: "EUR",
};

export function currencyForExchange(exchange: string | null | undefined): string {
  return EXCHANGE_CURRENCY[(exchange ?? "").trim().toUpperCase()] ?? "USD";
}
