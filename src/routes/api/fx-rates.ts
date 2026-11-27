import { createFileRoute } from "@tanstack/react-router";

let cachedRates: Record<string, number> | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 10 * 60 * 1000;

export const Route = createFileRoute("/api/fx-rates")({
  server: {
    handlers: {
      GET: async () => {
        if (cachedRates && Date.now() - cachedAt < CACHE_TTL_MS) {
          return Response.json(
            { result: "success", base_code: "USD", rates: cachedRates },
            { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=600" } },
          );
        }

        try {
          const response = await fetch("https://open.er-api.com/v6/latest/USD", {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; PSXL/1.0)" },
            signal: AbortSignal.timeout(8000),
          });
          if (!response.ok) {
            return Response.json({ result: "error", rates: {}, error: "FX provider unavailable" }, { status: 503 });
          }
          const payload = await response.json();
          if (payload?.result !== "success" || !payload?.rates || typeof payload.rates !== "object") {
            return Response.json({ result: "error", rates: {}, error: "Invalid FX provider response" }, { status: 502 });
          }
          cachedRates = payload.rates as Record<string, number>;
          cachedAt = Date.now();
          return Response.json(
            { result: "success", base_code: "USD", rates: cachedRates },
            { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=600" } },
          );
        } catch {
          return Response.json({ result: "error", rates: {}, error: "FX rates temporarily unavailable" }, { status: 503 });
        }
      },
    },
  },
});
