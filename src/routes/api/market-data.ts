import { createFileRoute } from "@tanstack/react-router";
import { correctKnownMarketListing, marketListingHint, normalizeMarketTicker } from "@/lib/market-currency";

export const Route = createFileRoute("/api/market-data")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const symbol = (url.searchParams.get("symbol") || "").trim().toUpperCase();
          const exchange = (url.searchParams.get("exchange") || "NYSE").trim().toUpperCase();
          const range = url.searchParams.get("range") || "1mo";
          const interval = url.searchParams.get("interval") || "1d";
          if (!/^(?:\^)?[A-Z0-9][A-Z0-9.&_-]{0,19}$/.test(symbol) || !/^[A-Z0-9 _.-]{2,40}$/.test(exchange) || !["1d", "5d", "1mo", "3mo", "1y"].includes(range) || !["5m", "30m", "1d"].includes(interval)) return Response.json({ points: [], error: "Invalid ticker, exchange, range, or interval. Ticker must be a symbol, not a company name." }, { status: 400 });
          const correction = correctKnownMarketListing(symbol, exchange);
          const resolvedSymbol = correction?.symbol ?? symbol;
          const resolvedExchange = correction?.exchange ?? exchange;
          const listingHint = marketListingHint(resolvedSymbol, resolvedExchange);
          if (listingHint) return Response.json({ points: [], code: "EXCHANGE_SYMBOL_MISMATCH", error: listingHint, requestedSymbol: symbol, exchange }, { status: 422 });
          const ticker = normalizeMarketTicker(resolvedSymbol, resolvedExchange);
          if (!ticker) return Response.json({ points: [], error: "This exchange is recognized for ledger and currency tracking, but its quote-provider symbol mapping is not available yet. Choose the exact local exchange or enter a provider-ready symbol such as ABC.L." }, { status: 422 });
          const response = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(ticker) + "?interval=" + interval + "&range=" + range, {
            headers: { "User-Agent": "Mozilla/5.0" },
            signal: AbortSignal.timeout(8000),
          });
          if (response.status === 404) {
            return Response.json({ points: [], code: "SYMBOL_NOT_FOUND", error: `No quote-provider listing was found for ${symbol} on ${exchange}. Check that the symbol belongs to the selected exchange.`, requestedSymbol: symbol, exchange, providerSymbol: ticker }, { status: 404 });
          }
          if (response.status === 429) {
            return Response.json({ points: [], code: "PROVIDER_RATE_LIMITED", error: "The market-data provider is rate-limiting requests. Retry shortly.", provider: "Yahoo Finance", requestedSymbol: symbol, providerSymbol: ticker }, { status: 503, headers: { "Retry-After": response.headers.get("Retry-After") || "60" } });
          }
          if (!response.ok) {
            const status = response.status >= 500 ? 503 : 422;
            return Response.json({ points: [], code: status === 503 ? "PROVIDER_UNAVAILABLE" : "UNSUPPORTED_SYMBOL", error: `Market data is unavailable for ${symbol} on ${exchange} (provider HTTP ${response.status}). Verify the listing or try again later.`, provider: "Yahoo Finance", requestedSymbol: symbol, providerSymbol: ticker }, { status });
          }
          const data = await response.json();
          const result = data.chart?.result?.[0];
          const providerError = data.chart?.error;
          if (!result || !Array.isArray(result.timestamp) || result.timestamp.length === 0) {
            return Response.json({ points: [], code: "NO_HISTORY", error: providerError?.description ?? `No historical data is available for ${symbol} on ${exchange}. Verify the exchange and symbol.`, requestedSymbol: symbol, exchange, providerSymbol: ticker }, { status: 404 });
          }
          const timestamps = result?.timestamp || [];
          const closes = result?.indicators?.quote?.[0]?.close || [];
          const points = timestamps.map((time: number, i: number) => ({ time: time * 1000, price: closes[i] })).filter((p: { time: number; price: number | null }) => typeof p.price === "number" && Number.isFinite(p.price));
          return Response.json({ points, meta: { symbol: result?.meta?.symbol, currency: result?.meta?.currency, source: "Yahoo Finance", fetchedAt: new Date().toISOString(), requestedSymbol: symbol, requestedExchange: exchange, resolvedSymbol, resolvedExchange, ...(correction ? { warning: correction.note } : {}) } });
        } catch (error) {
          const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
          return Response.json(
            { points: [], code: timedOut ? "PROVIDER_TIMEOUT" : "MARKET_DATA_ERROR", error: timedOut ? "The market-data provider timed out. Retry shortly." : "Market data could not be loaded right now." },
            { status: timedOut ? 504 : 503 },
          );
        }
      },
      POST: async ({ request }) => {
        try {
          const body = (await request.json().catch(() => null)) as {
            tickers?: Array<{ ticker?: string; exchange?: string }>;
          } | null;
          if (!body || !Array.isArray(body.tickers)) {
            return Response.json({ prices: [], error: "Provide a tickers array." }, { status: 400 });
          }
          if (body.tickers.length > 100) {
            return Response.json({ prices: [], error: "Request up to 100 symbols at a time." }, { status: 400 });
          }
          const tickers = body.tickers
            .filter((item): item is { ticker: string; exchange: string } =>
              typeof item?.ticker === "string" &&
              typeof item?.exchange === "string" &&
              /^(?:\^)?[A-Z0-9][A-Z0-9.&_=-]{0,19}$/i.test(item.ticker.trim()) &&
              /^[A-Z0-9 _.-]{2,40}$/i.test(item.exchange.trim()),
            )
            .map((item) => ({ ticker: item.ticker.trim().toUpperCase(), exchange: item.exchange.trim().toUpperCase() }));
          if (tickers.length !== body.tickers.length) {
            return Response.json({ prices: [], error: "One or more symbols or exchange codes are invalid." }, { status: 400 });
          }
          const prices = await fetchYahooPrices(tickers);
          return Response.json({ prices, requested: tickers.length, returned: prices.length });
        } catch (error) {
          return new Response(JSON.stringify({ prices: [] }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});

interface TickerQuote {
  symbol: string;
  regularMarketPrice: number;
  regularMarketChange: number;
  regularMarketChangePercent: number;
  currency: string;
  marketState: "REGULAR" | "CLOSED" | "PRE" | "POST";
}

interface MarketPrice {
  ticker: string;
  exchange: string;
  price: number;
  change: number;
  changePercent: number;
  currency: string;
  lastUpdated: string;
  resolvedTicker?: string;
  resolvedExchange?: string;
  warning?: string;
}

// ─── Fetch single ticker price from Yahoo Finance (server-side) ─────────────

async function fetchYahooPrice(ticker: string): Promise<TickerQuote | null> {
  try {
    const proxyUrl = "https://query1.finance.yahoo.com/v8/finance/chart/";
    const response = await fetch(`${proxyUrl}${ticker}?interval=1d&range=1d`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const result = data.chart?.result?.[0];
    const meta = result?.meta;
    const quote = result?.indicators?.quote?.[0];

    if (!meta || !quote) return null;

    const latestPrice = quote.close?.[quote.close.length - 1] || meta.regularMarketPrice;
    const prevClose = meta.previousClose || quote.open?.[0];

    if (!latestPrice || prevClose === undefined) return null;

    const change = latestPrice - prevClose;
    const changePercent = prevClose !== 0 ? (change / prevClose) * 100 : 0;

    return {
      symbol: meta.symbol,
      regularMarketPrice: latestPrice,
      regularMarketChange: change,
      regularMarketChangePercent: changePercent,
      currency: meta.currency || "USD",
      marketState: meta.marketState || "CLOSED",
    };
  } catch (error) {
    return null;
  }
}

// ─── Fetch multiple ticker prices (batched) ─────────────────────────────────

async function fetchYahooPrices(
  tickers: Array<{ ticker: string; exchange: string }>,
): Promise<MarketPrice[]> {
  const prices: MarketPrice[] = [];

  // Bound concurrency: parallelize across symbols without flooding the quote provider.
  const unique = [...new Map(tickers.map((item) => [`${item.exchange}:${item.ticker}`, item])).values()];
  const batchSize = 6;
  for (let i = 0; i < unique.length; i += batchSize) {
    const batch = unique.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(async ({ ticker, exchange }) => {
      const correction = correctKnownMarketListing(ticker, exchange);
      const resolvedTicker = correction?.symbol ?? ticker;
      const resolvedExchange = correction?.exchange ?? exchange;
      const providerSymbol = normalizeMarketTicker(resolvedTicker, resolvedExchange);
      if (!providerSymbol) return null;
      const quote = await fetchYahooPrice(providerSymbol);
      if (!quote) return null;
      return {
        ticker,
        exchange,
        ...(correction ? { resolvedTicker, resolvedExchange, warning: correction.note } : {}),
        price: quote.regularMarketPrice,
        change: quote.regularMarketChange,
        changePercent: quote.regularMarketChangePercent,
        // Prefer the provider's instrument currency over a guessed exchange default.
        currency: quote.currency || "USD",
        lastUpdated: new Date().toISOString(),
      } satisfies MarketPrice;
    }));
    prices.push(...results.filter((item): item is MarketPrice => item !== null));
  }
  return prices;
}
