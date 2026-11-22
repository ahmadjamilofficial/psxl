import { describe, expect, it } from "vitest";
import { currencyForExchange, exchangeInfo, SUPPORTED_EXCHANGES } from "./market-currency";

describe("global exchange directory", () => {
  it("includes major exchanges across all regions", () => {
    const codes = SUPPORTED_EXCHANGES.map((exchange) => exchange.code);
    for (const code of ["PSX", "NSE", "NYSE", "NASDAQ", "LSE", "TSX", "ASX", "HKEX", "TSE", "SGX", "XETRA", "B3", "TADAWUL", "JSE"]) {
      expect(codes).toContain(code);
    }
  });

  it("maps common MIC codes to their exchange currency", () => {
    expect(currencyForExchange("XNYS")).toBe("USD");
    expect(currencyForExchange("XLON")).toBe("GBP");
    expect(currencyForExchange("XASX")).toBe("AUD");
    expect(currencyForExchange("XHKG")).toBe("HKD");
    expect(currencyForExchange("XSHG")).toBe("CNY");
    expect(currencyForExchange("XSAU")).toBe("SAR");
    expect(currencyForExchange("XCAS")).toBe("MAD");
    expect(currencyForExchange("XLIM")).toBe("PEN");
    expect(currencyForExchange("XBKK")).toBe("THB");
  });

  it("returns market metadata for normalized exchange codes", () => {
    expect(exchangeInfo("  xnas ")?.name).toBe("Nasdaq");
    expect(exchangeInfo("PSX")?.country).toBe("Pakistan");
    expect(currencyForExchange("KSE")).toBe("PKR"); // legacy Karachi Stock Exchange alias
    expect(exchangeInfo("CNSX")?.currency).toBe("CAD");
    expect(exchangeInfo("CSE")?.country).toBe("Sri Lanka");
  });

  it("keeps unknown exchanges safe with a fallback currency", () => {
    expect(exchangeInfo("UNKNOWN")).toBeUndefined();
    expect(currencyForExchange("UNKNOWN")).toBe("USD");
  });
});
