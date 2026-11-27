import { createFileRoute } from "@tanstack/react-router";
import { normalizeMarketTicker } from "@/lib/market-currency";

const marketJson = (body: unknown, status = 200) =>
  marketJson(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
    },
  });

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
          if (!/^(?:\^)?[A-Z0-9][A-Z0-9.&_-]{0,19}$/.test(symbol) || !/^[A-Z0-9 _.-]{2,40}$/.test(exchange) || !["1d", "5d", "1mo", "3mo", "1y"].includes(range) || !["5m", "30m", "1d"].includes(interval)) return marketJson({ points: [], error: "Invalid ticker, exchange, range, or interval. Ticker must be a symbol, not a company name." }, { status: 400 });
          const ticker = normalizeMarketTicker(symbol, exchange);
          if (!ticker) return marketJson({ points: [], error: "This exchange is recognized for ledger and currency tracking, but its quote-provider symbol mapping is not available yet. Choose the exact local exchange or enter a provider-ready symbol such as ABC.L." }, { status: 422 });
          // Yahoo's primary edge intermittently returns 5xx/blocked responses.
          // Retry the secondary edge and degrade to an empty chart instead of
          // failing the whole dashboard with a 502.
          let data: any = null;
          let providerStatus = 0;
          for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
            try {
              const response = await fetch(
                `https://${host}/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}`,
                {
                  headers: { "User-Agent": "Mozilla/5.0 (compatible; PSXL/1.0)" },
                  signal: AbortSignal.timeout(8000),
                },
              );
              providerStatus = response.status;
              if (!response.ok) continue;
              data = await response.json();
              if (data.chart?.result?.[0]) break;
            } catch {
              // Try the secondary Yahoo edge.
            }
          }
          const result = data?.chart?.result?.[0];
          const providerError = data?.chart?.error;
          if (!result) return marketJson({
            points: [],
            error: providerError?.description ?? `Historical quotes are temporarily unavailable for ${ticker}. Ledger analytics remain available.`,
            provider: "Yahoo Finance",
            providerStatus: providerStatus || undefined,
            requestedSymbol: symbol,
            providerSymbol: ticker,
          }, 503);
          const timestamps = result?.timestamp || [];
          const closes = result?.indicators?.quote?.[0]?.close || [];
          const points = timestamps.map((time: number, i: number) => ({ time: time * 1000, price: closes[i] })).filter((p: { time: number; price: number | null }) => typeof p.price === "number" && Number.isFinite(p.price));
          return marketJson({ points, meta: { symbol: result?.meta?.symbol, currency: result?.meta?.currency, source: "Yahoo Finance", fetchedAt: new Date().toISOString() } });
        } catch {
          return marketJson({ points: [], error: "Market data is temporarily unavailable. Please retry shortly." });
        }
      },
      POST: async ({ request }) => {
        try {
          const body = (await request.json().catch(() => null)) as {
            tickers?: Array<{ ticker?: string; exchange?: string }>;
          } | null;
          if (!body || !Array.isArray(body.tickers)) {
            return marketJson({ prices: [], error: "Provide a tickers array." }, { status: 400 });
          }
          if (body.tickers.length > 100) {
            return marketJson({ prices: [], error: "Request up to 100 symbols at a time." }, { status: 400 });
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
            return marketJson({ prices: [], error: "One or more symbols or exchange codes are invalid." }, { status: 400 });
          }
          const prices = await fetchYahooPrices(tickers);
          return marketJson({ prices, requested: tickers.length, returned: prices.length });
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
}

// ─── Fetch single ticker price from Yahoo Finance (server-side) ─────────────

async function fetchYahooPrice(ticker: string): Promise<TickerQuote | null> {
  try {
    let data: any = null;
    for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
      try {
        const response = await fetch(`https://${host}/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; PSXL/1.0)" },
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) continue;
        data = await response.json();
        if (data.chart?.result?.[0]) break;
      } catch {
        // Continue to the secondary Yahoo edge.
      }
    }
    if (!data) return null;
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
      const providerSymbol = normalizeMarketTicker(ticker, exchange);
      if (!providerSymbol) return null;
      const quote = await fetchYahooPrice(providerSymbol);
      if (!quote) return null;
      return {
        ticker,
        exchange,
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
