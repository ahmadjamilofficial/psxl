import { createFileRoute } from "@tanstack/react-router";
import { exchangeCurrency } from "@/lib/market-currency";
import { ASSISTANT_NAME, BRAND_NAME, brandText } from "@/lib/brand";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateText,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import {
  describeAttempts,
  isCapacityError,
  markProviderUnhealthy,
  resolveAgentModel,
  type ResolvedModel,
} from "@/lib/audit-agent.server";
import { serverEnv, supabaseServerConfig } from "@/lib/env.server";
import { pickCascadeForPlan, planOf } from "@/lib/plans";
import { computeTax } from "@/lib/tax";
import { computePortfolioSummary } from "@/lib/financial-intelligence";
import type { Transaction } from "@/lib/demo-data";

type ChatBody = { id?: unknown; messages?: unknown };

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

function isSimpleGreeting(messages: unknown[]): boolean {
  const last = [...messages]
    .reverse()
    .find(
      (message) =>
        message && typeof message === "object" && (message as { role?: unknown }).role === "user",
    ) as { parts?: unknown[] } | undefined;
  if (
    !last?.parts ||
    last.parts.some(
      (part) => part && typeof part === "object" && (part as { type?: string }).type === "file",
    )
  )
    return false;
  const value = last.parts
    .map((part) =>
      part && typeof part === "object" && (part as { type?: string }).type === "text"
        ? ((part as { text?: string }).text ?? "")
        : "",
    )
    .join(" ")
    .trim();
  return /^(hi|hello|hey|helo|good morning|good afternoon|good evening|yo|salaam|assalamualaikum)[!.\s]*$/i.test(
    value,
  );
}

const DETERMINISTIC_GREETING =
  `Hi — I’m ${ASSISTANT_NAME}, your financial operations copilot. Ask me about your ledger, upload a broker statement, or connect a source and I’ll help you investigate it.`;

function replayIteratorStream<T>(
  first: IteratorResult<T>,
  iterator: AsyncIterator<T>,
  onError?: (error: unknown) => void,
): ReadableStream<T> {
  let sentFirst = false;
  return new ReadableStream<T>({
    async pull(controller) {
      try {
        if (!sentFirst) {
          sentFirst = true;
          if (first.done) {
            controller.close();
            return;
          }
          controller.enqueue(first.value);
          return;
        }
        const next = await iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (error) {
        // Close the stream cleanly instead of erroring it. If we call
        // controller.error() the writer's output stream dies immediately,
        // so the onError handler can no longer deliver a useful message to
        // the client (they get the generic "An error occurred."). Closing
        // cleanly keeps the writer writable while execute() detects the
        // failure via result.response (or the captured error) and triggers
        // onError with a real, human-readable message.
        onError?.(error);
        controller.close();
      }
    },
  });
}

const SHEET_RE = /\.(xlsx|xls|csv|txt|tsv)$/i;
const SHEET_TYPES = ["spreadsheetml", "ms-excel", "text/csv", "text/plain", "tab-separated"];

/** Convert Excel/CSV/text file parts into text parts the model can read. */
async function spreadsheetsToText(messages: UIMessage[]): Promise<UIMessage[]> {
  let XLSX: typeof import("xlsx") | null = null;
  return Promise.all(
    messages.map(async (m) => {
      if (m.role !== "user") return m;
      const parts = await Promise.all(
        m.parts.map(async (p) => {
          if (p.type !== "file") return p;
          const name = p.filename ?? "file";
          const isImage = (p.mediaType ?? "").startsWith("image/");
          const isPdf = /\.pdf$/i.test(name) || (p.mediaType ?? "").includes("pdf");
          const isSheet = SHEET_RE.test(name) || SHEET_TYPES.some((t) => p.mediaType?.includes(t));
          if (isImage || isPdf) return p;
          if (!p.url?.startsWith("data:")) {
            return {
              type: "text" as const,
              text: `The user attached "${name}" (${p.mediaType || "file"}). Treat this as an uploaded document in this turn.`,
            };
          }
          if (!isSheet) {
            return {
              type: "text" as const,
              text: `The user attached a file named "${name}" (${p.mediaType || "document"}). It is included in this message as context — read and use it. Do not say there is no file attached.`,
            };
          }
          try {
            const b64 = p.url.slice(p.url.indexOf(",") + 1);
            const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
            let body: string;
            if (
              /\.(xlsx|xls)$/i.test(name) ||
              p.mediaType?.includes("sheet") ||
              p.mediaType?.includes("excel")
            ) {
              XLSX ??= await import("xlsx");
              const wb = XLSX.read(bytes, { type: "array" });
              body = wb.SheetNames.map(
                (s) => `### Sheet: ${s}\n${XLSX!.utils.sheet_to_csv(wb.Sheets[s]!)}`,
              ).join("\n\n");
            } else {
              body = new TextDecoder().decode(bytes);
            }
            return {
              type: "text" as const,
              text: `Attached file "${name}":\n\`\`\`\n${body.slice(0, 60000)}\n\`\`\``,
            };
          } catch {
            return { type: "text" as const, text: `Attached file "${name}" could not be read.` };
          }
        }),
      );
      return { ...m, parts } as UIMessage;
    }),
  );
}

/** Safe arithmetic evaluator (no eval — Workers forbid it). */
function evaluateExpression(input: string): number {
  const tokens = input.match(/\d+(\.\d+)?|[+\-*/()%]/g);
  if (!tokens || tokens.join("") !== input.replace(/\s+/g, "")) {
    throw new Error("Expression may only contain numbers and + - * / % ( )");
  }
  let pos = 0;
  const peek = () => tokens[pos];
  const parseExpr = (): number => {
    let value = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = tokens[pos++];
      const rhs = parseTerm();
      value = op === "+" ? value + rhs : value - rhs;
    }
    return value;
  };
  const parseTerm = (): number => {
    let value = parseFactor();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = tokens[pos++];
      const rhs = parseFactor();
      if (op === "*") value *= rhs;
      else if (op === "/") value /= rhs;
      else value = (value * rhs) / 100;
    }
    return value;
  };
  const parseFactor = (): number => {
    const token = tokens[pos];
    if (token === "(") {
      pos++;
      const value = parseExpr();
      if (tokens[pos] !== ")") throw new Error("Unbalanced parentheses");
      pos++;
      return value;
    }
    if (token === "-") {
      pos++;
      return -parseFactor();
    }
    pos++;
    const value = Number(token);
    if (Number.isNaN(value)) throw new Error(`Unexpected token: ${token}`);
    return value;
  };
  const result = parseExpr();
  if (pos !== tokens.length) throw new Error("Could not parse expression");
  return result;
}

const SPECIALISTS = {
  extraction:
    "You are the Data Extraction Agent. Read documents, statements, invoices, contract notes and spreadsheets supplied in the objective/context. Return every field you can support (ticker, action, quantity, price, fees, WHT, date, reference, broker, exchange, totals) with a per-field confidence 0-1 and the exact source line/label you read it from. Never invent a value; write UNKNOWN instead.",
  analysis:
    "You are the Financial Analysis Agent. Analyse holdings, performance, exposure, cost basis and cash flows from the supplied data only. Quantify everything and state the arithmetic you relied on.",
  reconciliation:
    "You are the Reconciliation Agent. Compare two or more sets of records, match on reference/date/quantity/price, and list matched, unmatched and partially matched items with exact deltas.",
  compliance:
    "You are the Audit & Compliance Agent. Test the data for anomalies, duplicates, fee surcharges, WHT mismatches, out-of-sequence dates, missing references and policy risks. Rate each finding low/medium/high.",
  evidence:
    "You are the Evidence & Verification Agent. For every claim supplied to you, name the specific source document, row, reference id or ledger record that supports it, and mark anything unsupported as ASSUMPTION.",
  research:
    "You are the Research Agent. Using only the context supplied (no browsing), summarise relevant market, tax-rule or broker-format knowledge, and clearly label anything that is general knowledge rather than user data.",
  calculation:
    "You are the Calculation Agent. Recompute every material figure from the supplied numbers using explicit arithmetic. Return labelled values, the expression used, and flag any missing inputs. Never estimate.",
  quality:
    "You are the Quality Control Agent. Independently re-check the supplied findings for arithmetic errors, contradictions, unsupported claims and missing caveats. Return PASS or REVISE with a precise list of corrections.",
} as const;

const LEDGER_TEMPLATE_COLUMNS = [
  "ticker",
  "action",
  "quantity",
  "price",
  "fees",
  "wht",
  "trade_date",
  "ref_id",
  "broker",
  "exchange",
] as const;

function csvEscape(value: string | number | null | undefined) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>) {
  return [
    headers.map(csvEscape).join(","),
    ...rows.map((row) => row.map(csvEscape).join(",")),
  ].join("\n");
}

function asTransaction(row: {
  id: string;
  ticker: string;
  action: string;
  quantity: number;
  price: number;
  fees: number;
  wht: number;
  trade_date: string;
  ref_id: string;
  confidence_score: number;
  status: string;
  broker: string;
  exchange: string;
  currency?: string | null;
}): Transaction {
  return {
    id: row.id,
    ticker: row.ticker,
    action: row.action as Transaction["action"],
    quantity: Number(row.quantity),
    price: Number(row.price),
    fees: Number(row.fees ?? 0),
    wht: Number(row.wht ?? 0),
    trade_date: row.trade_date,
    ref_id: row.ref_id,
    confidence_score: Number(row.confidence_score ?? 0),
    status: row.status as Transaction["status"],
    broker: row.broker,
    exchange: row.exchange,
    currency: row.currency ?? exchangeCurrency(row.exchange) ?? undefined,
  };
}

function missingFields(row: {
  ticker: string;
  action: string;
  quantity: number;
  price: number;
  trade_date: string;
  ref_id: string;
}) {
  const missing: string[] = [];
  if (!row.ticker || row.ticker === "UNKNOWN") missing.push("ticker");
  if (!["BUY", "SELL", "DIV"].includes(row.action)) missing.push("action");
  if (!row.quantity) missing.push("quantity");
  if (!row.price) missing.push("price");
  if (!row.trade_date) missing.push("trade_date");
  if (!row.ref_id) missing.push("ref_id");
  return missing;
}

// Lets sites hosted elsewhere (e.g. psxl.live on Vercel) use the Lovable-hosted
// AI endpoint. Callers are still authenticated by their bearer token.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-requested-with",
  "Access-Control-Expose-Headers": "*",
};
type Handler = (ctx: { request: Request }) => Promise<Response>;
function withCors(handlers: Record<string, Handler>) {
  const wrapped: Record<string, Handler> = {
    OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
  };
  for (const [method, fn] of Object.entries(handlers)) {
    wrapped[method] = async (ctx) => {
      const res = await fn(ctx);
      const headers = new Headers(res.headers);
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    };
  }
  return wrapped;
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: withCors({
      // ── DELETE /api/chat?threadId=xxx — clear a chat thread ──────────────
      DELETE: async ({ request }) => {
        const authorization = request.headers.get("authorization") ?? "";
        if (!authorization.startsWith("Bearer "))
          return new Response("Unauthorized", { status: 401 });

        const url2 = new URL(request.url);
        const threadId = url2.searchParams.get("threadId");
        if (!threadId) return new Response("threadId is required", { status: 400 });

        const supabaseConfig = supabaseServerConfig();
        if (!supabaseConfig)
          return new Response(
            "Database configuration is missing: set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY",
            { status: 500 },
          );

        const db = createClient<Database>(supabaseConfig.url, supabaseConfig.key, {
          global: { headers: { Authorization: authorization } },
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: authData, error: authError } = await db.auth.getUser();
        if (authError || !authData.user) return new Response("Unauthorized", { status: 401 });

        // Verify ownership
        const { data: thread } = await db
          .from("chat_threads")
          .select("id")
          .eq("id", threadId)
          .eq("user_id", authData.user.id)
          .maybeSingle();
        if (!thread) return new Response("Thread not found", { status: 404 });

        // Delete messages first (FK), then thread
        await db.from("chat_messages").delete().eq("thread_id", threadId);
        const { error: delErr } = await db
          .from("chat_threads")
          .delete()
          .eq("id", threadId)
          .eq("user_id", authData.user.id);
        if (delErr) return new Response(delErr.message, { status: 500 });

        return new Response(JSON.stringify({ deleted: true, threadId }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },

      POST: async ({ request }) => {
        try {
          const authorization = request.headers.get("authorization") ?? "";
          if (!authorization.startsWith("Bearer "))
            return new Response("Unauthorized", { status: 401 });

          let body: ChatBody;
          try {
            body = (await request.json()) as ChatBody;
          } catch (e) {
            return new Response(
              JSON.stringify({ code: "invalid_json", message: "Invalid JSON body" }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              },
            );
          }

          if (typeof body.id !== "string" || !Array.isArray(body.messages)) {
            return new Response("A thread id and messages are required", { status: 400 });
          }

          // Greetings should remain available even if every external provider is down.
          if (isSimpleGreeting(body.messages)) {
            const greetingConfig = supabaseServerConfig();
            if (!greetingConfig)
              return new Response("Database configuration is missing", { status: 500 });
            const greetingDb = createClient<Database>(greetingConfig.url, greetingConfig.key, {
              global: { headers: { Authorization: authorization } },
              auth: { persistSession: false, autoRefreshToken: false },
            });
            const { data: greetingAuth, error: greetingAuthError } =
              await greetingDb.auth.getUser();
            if (greetingAuthError || !greetingAuth.user)
              return new Response("Unauthorized", { status: 401 });
            const { data: greetingThread, error: greetingThreadError } = await greetingDb
              .from("chat_threads")
              .select("id, org_id")
              .eq("id", body.id)
              .eq("user_id", greetingAuth.user.id)
              .single();
            if (greetingThreadError || !greetingThread)
              return new Response("Thread not found", { status: 404 });
            const greetingStream = createUIMessageStream({
              originalMessages: body.messages as UIMessage[],
              execute: ({ writer }) => {
                writer.write({ type: "text-start", id: "wab-greeting" });
                writer.write({
                  type: "text-delta",
                  id: "wab-greeting",
                  delta: DETERMINISTIC_GREETING,
                });
                writer.write({ type: "text-end", id: "wab-greeting" });
              },
              onEnd: async ({ messages }) => {
                const seen = new Map<string, UIMessage>();
                messages.forEach((message) => seen.set(message.id, message));
                await greetingDb.from("chat_messages").upsert(
                  Array.from(seen.values()).map((message, position) => ({
                    thread_id: greetingThread.id,
                    org_id: greetingThread.org_id,
                    user_id: greetingAuth.user.id,
                    ai_message_id: message.id,
                    role: message.role,
                    parts: message.parts as never,
                    position,
                  })),
                  { onConflict: "thread_id,ai_message_id" },
                );
                await greetingDb
                  .from("chat_threads")
                  .update({ title: "Hello", updated_at: new Date().toISOString() })
                  .eq("id", greetingThread.id);
              },
            });
            return createUIMessageStreamResponse({ stream: greetingStream });
          }
          const supabaseConfig = supabaseServerConfig();
          const approvalSecret = serverEnv("TOOL_APPROVAL_SECRET") ?? "wab-tool-approval";
          if (!supabaseConfig)
            return new Response(
              "Database configuration is missing: set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY",
              { status: 500 },
            );
          const url = supabaseConfig.url;
          const key = supabaseConfig.key;

          // Provider env comes from the Worker runtime, process.env or Vite's env.
          const env = (globalThis as { __VERCEL_ENV__?: Record<string, unknown> }).__VERCEL_ENV__;

          let resolved: ResolvedModel | null;
          try {
            resolved = await resolveAgentModel(env);
          } catch (e) {
            console.error(brandText("[{{brand}} Chat] AI Model Resolution Error:"), e);
            return new Response(
              JSON.stringify({
                code: "ai_resolution_error",
                message: "Failed to resolve AI model",
                error: e instanceof Error ? e.message : String(e),
              }),
              { status: 500, headers: { "Content-Type": "application/json" } },
            );
          }

          if (!resolved) {
            // Key is missing or placeholder — tell the operator exactly what to do
            console.error(brandText("[{{brand}} Chat] AI Not Configured - No valid API key found"));
            return new Response(
              JSON.stringify({
                code: "ai_not_configured",
                message: describeAttempts([]),
              }),
              { status: 503, headers: { "Content-Type": "application/json" } },
            );
          }

          // Do not probe every provider before every chat turn. Cold serverless
          // isolates made those parallel probes add seconds before the first token.
          // Start with the plan-selected model immediately; the stream loop below
          // falls back to the next configured provider if the first connection fails.
          const workingModel = { ...resolved, attempts: [] as Array<{ provider: string; modelId: string; ok: boolean }> };
          console.log(brandText("[{{brand}} Chat] AI Model Resolved:"), {
            provider: workingModel.provider,
            modelId: workingModel.modelId,
          });
          let model = workingModel.model;
          let chosenModel: ResolvedModel = workingModel;

          const supabase = createClient<Database>(url, key, {
            global: { headers: { Authorization: authorization } },
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { data: authData, error: authError } = await supabase.auth.getUser();
          if (authError || !authData.user) return new Response("Unauthorized", { status: 401 });

          const { data: thread, error: threadError } = await supabase
            .from("chat_threads")
            .select("id, org_id")
            .eq("id", body.id)
            .eq("user_id", authData.user.id)
            .single();
          if (threadError || !thread) return new Response("Thread not found", { status: 404 });

          // ── Plan entitlements (Free / Pro / Enterprise — no checkout, mailto upgrades) ──
          // A missing or inactive subscription row means the org is on the Free plan.
          const { data: subData } = await supabase
            .from("subscriptions")
            .select(
              "plan, status, trial_end_at, charge_period, current_period_end, created_at, cancel_at_period_end",
            )
            .eq("org_id", thread.org_id)
            .maybeSingle();

          const subActive = subData && ["active", "trialing"].includes(subData.status as string);
          const trialValid = subData?.trial_end_at
            ? new Date(subData.trial_end_at) > new Date()
            : false;
          const pausedToFree = subData?.cancel_at_period_end === true;
          const periodDays = subData?.charge_period === "YEARLY" ? 365 : 30;
          const started = subData?.created_at ? new Date(subData.created_at).getTime() : 0;
          const strictEnd = started ? started + periodDays * 86_400_000 : 0;
          const serverEnd = subData?.current_period_end
            ? new Date(subData.current_period_end).getTime()
            : 0;
          const cycleEnd = Math.min(...[strictEnd, serverEnd].filter((n) => n > 0));
          const cycleExpired = cycleEnd > 0 && Date.now() >= cycleEnd;
          const rawPlan = (subData?.plan as string) ?? "free";
          const plan =
            subActive &&
            !pausedToFree &&
            !cycleExpired &&
            (subData?.status !== "trialing" || trialValid)
              ? rawPlan
              : "free";
          const limits = planOf(plan);
          const isPro = plan === "pro";

          // Enforce the same limit shown in the Usage screen on the server.
          // Client-side counters are informational and must never be trusted.
          const usageSince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
          const { data: usageRows, error: usageReadError } = await supabase
            .from("ai_usage")
            .select("credits_used")
            .eq("user_id", authData.user.id)
            .eq("status", "ok")
            .gte("created_at", usageSince);
          if (usageReadError) {
            console.error("[PSXL Chat] Usage quota lookup failed:", usageReadError.message);
            return new Response(
              JSON.stringify({ code: "quota_check_unavailable", message: "PSXL could not verify your AI quota. Please retry shortly." }),
              { status: 503, headers: { "Content-Type": "application/json" } },
            );
          }
          const creditsUsed = (usageRows ?? []).reduce(
            (total, row) => total + Number(row.credits_used ?? 0),
            0,
          );
          if (creditsUsed >= limits.dailyAiCredits) {
            return new Response(
              JSON.stringify({
                code: "quota_exceeded",
                plan,
                daily_limit: limits.dailyAiCredits,
                credits_used: creditsUsed,
                message: `Your ${limits.name} plan has used all ${limits.dailyAiCredits} AI credits for the last 24 hours.`,
              }),
              {
                status: 429,
                headers: { "Content-Type": "application/json", "Retry-After": "86400" },
              },
            );
          }

          // Higher plans get larger tool budgets and better models.
          // A compact ceiling prevents agent loops from spending the whole turn on repeated tool cycles.
          const maxSteps = Math.min(limits.maxAgentSteps, 6);
          const monthlyTxLimit = limits.transactionsPerMonth; // null = unlimited
          const canDelegate = limits.features.specialistAgents;

          const cascadeFallback = workingModel.cascade[0];
          if (cascadeFallback) {
            const picked = pickCascadeForPlan(workingModel.cascade, plan, cascadeFallback);
            const selectedModel: ResolvedModel = {
              ...workingModel,
              modelId: picked.modelId,
              model: picked.model,
              provider: picked.provider,
              providerOptions: picked.providerOptions,
            };
            chosenModel = selectedModel;
            model = selectedModel.model;
          }

          // Record usage synchronously so a failed write cannot silently bypass
          // plan limits. Charge against the actual plan-selected model.
          const usageId = crypto.randomUUID();
          const { error: usageWriteError } = await supabase
            .from("ai_usage")
            .insert({
              id: usageId,
              user_id: authData.user.id,
              org_id: thread.org_id,
              plan,
              thread_id: thread.id,
              model: chosenModel.modelId,
              inference_requests: 1,
              credits_used: 1,
              status: "ok",
            } as never);
          if (usageWriteError) {
            console.error("[PSXL Chat] Usage quota write failed:", usageWriteError.message);
            return new Response(
              JSON.stringify({ code: "quota_accounting_unavailable", message: "PSXL could not record AI usage, so this request was not started. Please retry shortly." }),
              { status: 503, headers: { "Content-Type": "application/json" } },
            );
          }

          // ── Convert UI messages to AI messages ─────────────────────────────
          let uiMessages: UIMessage[];
          try {
            uiMessages = await spreadsheetsToText(body.messages as UIMessage[]);
          } catch (e) {
            return new Response(
              JSON.stringify({
                code: "message_conversion_error",
                message: "Failed to process message attachments",
                error: e instanceof Error ? e.message : String(e),
              }),
              { status: 500, headers: { "Content-Type": "application/json" } },
            );
          }

          const audit = async (
            action: string,
            entityId: string,
            payload: Record<string, unknown>,
          ) => {
            const encoded = new TextEncoder().encode(
              `${Date.now()}-${action}-${entityId}-${authData.user.id}`,
            );
            const digest = await crypto.subtle.digest("SHA-256", encoded);
            const hash = Array.from(new Uint8Array(digest))
              .map((byte) => byte.toString(16).padStart(2, "0"))
              .join("");
            const { error } = await supabase.from("audit_log").insert({
              org_id: thread.org_id,
              actor: authData.user.email ?? authData.user.id,
              action,
              entity_type: "transaction",
              entity_id: entityId,
              payload: payload as never,
              prev_hash: "",
              hash,
            });
            if (error) {
              // Silent error handling for audit log
            }
          };

          // Hard cap specialist generations across this entire user turn,
          // including repeated calls to either delegation tool.
          let specialistWorkersRemaining = 4;
          let planTaskUsed = false;
          let progressUpdatesUsed = 0;

          const tools = {
            plan_task: tool({
              description:
                "For genuinely complex, multi-stage audits only: publish one concise work plan. Call at most once per user turn. Do not call for simple lookups, scans, summaries, or one-step tasks. After publishing the plan, execute the required tools; do not repeat the plan.",
              inputSchema: z.object({
                objective: z.string(),
                steps: z.array(z.string()),
                agents_needed: z.array(z.string()),
                public_stage: z
                  .enum([
                    "Understanding your task",
                    "Extracting financial data",
                    "Running reconciliation",
                    "Verifying evidence",
                    "Checking calculations",
                    "Delegating specialist agents",
                    "Synthesizing findings",
                    "Preparing findings",
                  ])
                  .nullable(),
              }),
              execute: async (input) => {
                if (planTaskUsed) return { ...input, accepted: false, note: "A work plan has already been published. Continue with execution and provide the answer." };
                planTaskUsed = true;
                return { ...input, accepted: true };
              },
            }),
            delegate_agent: tool({
              description:
                "Delegate a focused sub-task to a specialist agent (extraction, analysis, reconciliation, compliance, evidence, research, quality). Pass all data the specialist needs inside `context` — specialists cannot see the conversation.",
              inputSchema: z.object({
                agent: z.enum([
                  "extraction",
                  "analysis",
                  "reconciliation",
                  "compliance",
                  "evidence",
                  "research",
                  "calculation",
                  "quality",
                ]),
                objective: z.string(),
                context: z.string(),
              }),
              execute: async ({ agent, objective, context }) => {
                if (!canDelegate) {
                  return {
                    agent,
                    findings:
                      "Specialist agents are a Pro capability. This account is on a limited plan: answer directly from the data already available, and mention that Pro unlocks the full specialist audit team.",
                    model_used: "not_available_on_free_plan",
                  };
                }
                if (specialistWorkersRemaining < 1) {
                  return {
                    agent,
                    status: "unavailable",
                    findings:
                      "The per-request specialist limit has been reached. Continue with direct evidence and ledger tools.",
                    model_used: chosenModel.modelId,
                  };
                }
                specialistWorkersRemaining -= 1;
                try {
                  const sub = await generateText({
                    model,
                    providerOptions: chosenModel.providerOptions as never,
                    system: `${SPECIALISTS[agent]}\n\nYou are read-only. Work only from the supplied data. Return compact markdown under 350 words with findings, evidence references, and confidence; never expose hidden reasoning.`,
                    prompt: `Objective:\n${objective}\n\nData and context:\n${context.slice(0, 12000)}`,
                    maxOutputTokens: 500,
                    maxRetries: 1,
                    abortSignal: AbortSignal.timeout(25_000),
                  });
                  return {
                    agent,
                    status: "completed",
                    findings: sub.text.trim(),
                    model_used: chosenModel.modelId,
                  };
                } catch (error) {
                  console.warn(brandText("[{{brand}} Chat] specialist worker failed:"), {
                    agent,
                    error: error instanceof Error ? error.message : "unknown",
                  });
                  return {
                    agent,
                    status: "unavailable",
                    findings:
                      "This specialist could not complete its review. Verify this area directly before drawing a conclusion.",
                    model_used: chosenModel.modelId,
                  };
                }
              },
            }),
            delegate_agents: tool({
              description:
                "For a genuinely complex audit, delegate 2–4 independent read-only subtasks to specialist agents concurrently. A hard budget allows at most four specialist generations total per user turn across all delegation calls. Give every worker a distinct objective and its evidence. Workers cannot call tools or change data. Do not use this for simple questions or dependent steps; verify and synthesize their findings yourself.",
              inputSchema: z.object({
                tasks: z
                  .array(
                    z.object({
                      agent: z.enum([
                        "extraction",
                        "analysis",
                        "reconciliation",
                        "compliance",
                        "evidence",
                        "research",
                        "calculation",
                        "quality",
                      ]),
                      objective: z.string().min(1).max(400),
                      context: z.string().max(12000),
                    }),
                  )
                  .min(2)
                  .max(4),
              }),
              execute: async ({ tasks }) => {
                if (!canDelegate) {
                  return {
                    delegated: false,
                    reason: "Specialist agents are not enabled on this plan.",
                    completed: 0,
                    total: 0,
                    results: [],
                  };
                }
                if (specialistWorkersRemaining < 2) {
                  return {
                    delegated: false,
                    reason:
                      "The per-request specialist limit has been reached; continue with direct evidence and ledger tools.",
                    completed: 0,
                    total: 0,
                    results: [],
                  };
                }
                const dispatchedTasks = tasks.slice(0, specialistWorkersRemaining);
                specialistWorkersRemaining -= dispatchedTasks.length;
                const outcomes = await Promise.allSettled(
                  dispatchedTasks.map(async ({ agent, objective, context }) => {
                    const worker = await generateText({
                      model,
                      providerOptions: chosenModel.providerOptions as never,
                      system: `${SPECIALISTS[agent]}\n\nYou are a read-only worker. You cannot access tools or perform actions. Work only from the explicit context below. Distinguish observed evidence from assumptions. Return compact markdown under 350 words with findings and confidence; do not reveal hidden reasoning.`,
                      prompt: `Objective (only this subtask):\n${objective}\n\nEvidence supplied by the lead agent:\n${context.slice(0, 12000)}`,
                      maxOutputTokens: 500,
                      maxRetries: 1,
                      abortSignal: AbortSignal.timeout(25_000),
                    });
                    return { agent, objective, findings: worker.text.trim() };
                  }),
                );
                const results = outcomes.map((outcome, index) => {
                  if (outcome.status === "fulfilled") {
                    return { ...outcome.value, status: "completed" as const };
                  }
                  console.warn(brandText("[{{brand}} Chat] specialist worker failed:"), {
                    agent: dispatchedTasks[index]?.agent,
                    error: outcome.reason instanceof Error ? outcome.reason.message : "unknown",
                  });
                  return {
                    agent: dispatchedTasks[index]!.agent,
                    objective: dispatchedTasks[index]!.objective,
                    status: "unavailable" as const,
                    findings:
                      "This specialist could not complete its subtask. Verify this area directly before drawing a conclusion.",
                  };
                });
                return {
                  delegated: true,
                  model_used: chosenModel.modelId,
                  completed: results.filter((result) => result.status === "completed").length,
                  total: results.length,
                  requested: tasks.length,
                  truncated: dispatchedTasks.length < tasks.length,
                  results,
                };
              },
            }),
            calculate: tool({
              description:
                "Perform exact arithmetic. Use this for every financial number instead of computing mentally.",
              inputSchema: z.object({
                items: z.array(z.object({ label: z.string(), expression: z.string() })),
              }),
              execute: async ({ items }) =>
                items.map((item) => {
                  try {
                    return {
                      label: item.label,
                      expression: item.expression,
                      value: evaluateExpression(item.expression),
                    };
                  } catch (cause) {
                    return {
                      label: item.label,
                      expression: item.expression,
                      error: cause instanceof Error ? cause.message : "Invalid expression",
                    };
                  }
                }),
            }),
            get_latest_trade_metrics: tool({
              description:
                "Read the most recent trade from the signed-in user's ledger and calculate its gross value, fees/WHT total, and net cash impact. Use for questions like latest trade metrics or metrics from my last trade. Read-only and deterministic.",
              inputSchema: z.object({ ticker: z.string().nullable() }),
              execute: async ({ ticker }) => {
                let query = supabase
                  .from("transactions")
                  .select(
                    "id,ticker,action,quantity,price,fees,wht,trade_date,ref_id,broker,exchange,currency,status,confidence_score",
                  )
                  .eq("org_id", thread.org_id)
                  .order("trade_date", { ascending: false })
                  .order("created_at", { ascending: false })
                  .limit(1);
                if (ticker) query = query.eq("ticker", ticker.toUpperCase());
                const { data, error } = await query;
                if (error) throw new Error(error.message);
                const trade = data?.[0];
                if (!trade)
                  return { found: false, note: "No trade records were found in the ledger." };
                const quantity = Number(trade.quantity);
                const price = Number(trade.price);
                const fees = Number(trade.fees ?? 0);
                const wht = Number(trade.wht ?? 0);
                const grossValue = quantity * price;
                const totalCharges = fees + wht;
                return {
                  found: true,
                  source: "user_ledger",
                  trade: {
                    id: trade.id,
                    ticker: trade.ticker,
                    action: trade.action,
                    quantity,
                    price,
                    trade_date: trade.trade_date,
                    reference: trade.ref_id,
                    broker: trade.broker,
                    exchange: trade.exchange,
                    currency: trade.currency,
                    status: trade.status,
                    confidence_score: trade.confidence_score,
                  },
                  metrics: {
                    gross_value: grossValue,
                    fees,
                    withholding_tax: wht,
                    total_charges: totalCharges,
                    net_cash_impact:
                      trade.action === "SELL"
                        ? grossValue - totalCharges
                        : grossValue + totalCharges,
                  },
                  note: "Net cash impact is gross value adjusted by fees and withholding tax; BUY adds charges, SELL subtracts charges. This is ledger-derived, not a live market valuation.",
                };
              },
            }),
            get_transactions: tool({
              description:
                "Read the signed-in user's real transaction ledger before answering questions about trades, holdings, fees, or tax.",
              inputSchema: z.object({
                ticker: z.string().nullable(),
                action: z.string().nullable(),
                limit: z.number().nullable(),
              }),
              execute: async ({ ticker, action, limit }) => {
                let query = supabase
                  .from("transactions")
                  .select(
                    "id,ticker,action,quantity,price,fees,wht,trade_date,ref_id,broker,exchange,currency,status",
                  )
                  .eq("org_id", thread.org_id)
                  .order("trade_date", { ascending: false })
                  .limit(Math.min(Math.max(limit ?? 30, 1), 50));
                if (ticker) query = query.eq("ticker", ticker.toUpperCase());
                if (action)
                  query = query.eq("action", action.toUpperCase() as "BUY" | "SELL" | "DIV");
                const { data, error } = await query;
                if (error) throw new Error(error.message);
                return data;
              },
            }),
            get_ledger_summary: tool({
              description:
                "Read a compact real-data summary of the user's ledger and open reconciliation flags.",
              inputSchema: z.object({}),
              execute: async () => {
                const [transactions, flags] = await Promise.all([
                  supabase
                    .from("transactions")
                    .select("id,ticker,status")
                    .eq("org_id", thread.org_id),
                  supabase
                    .from("reconciliation_flags")
                    .select("id,severity")
                    .eq("org_id", thread.org_id)
                    .eq("status", "open"),
                ]);
                if (transactions.error) throw new Error(transactions.error.message);
                if (flags.error) throw new Error(flags.error.message);
                return {
                  totalTransactions: transactions.data.length,
                  needsReview: transactions.data.filter((row) => row.status === "needs_review")
                    .length,
                  openFlags: flags.data.length,
                  tickers: [...new Set(transactions.data.map((row) => row.ticker))],
                };
              },
            }),
            get_open_flags: tool({
              description:
                "Read the open reconciliation flags with full detail so findings can cite them as evidence.",
              inputSchema: z.object({}),
              execute: async () => {
                const { data, error } = await supabase
                  .from("reconciliation_flags")
                  .select(
                    "id,flag_type,severity,ticker,ref_id,expected,actual,description,suggested_resolution,status",
                  )
                  .eq("org_id", thread.org_id)
                  .eq("status", "open")
                  .limit(50);
                if (error) throw new Error(error.message);
                return data;
              },
            }),
            insert_transaction: tool({
              description:
                "Create a transaction in the real ledger. Runs immediately and is audited.",
              inputSchema: z.object({
                ticker: z.string(),
                action: z.string(),
                quantity: z.number(),
                price: z.number(),
                fees: z.number().nullable(),
                wht: z.number().nullable(),
                trade_date: z.string(),
                ref_id: z.string().nullable(),
                broker: z.string().nullable(),
                exchange: z.string().nullable(),
                currency: z.string().nullable().optional(),
                confidence_score: z.number().min(0).max(1).optional(),
              }),
              execute: async (input) => {
                const action = input.action.toUpperCase();
                if (!(["BUY", "SELL", "DIV"] as string[]).includes(action))
                  throw new Error("Action must be BUY, SELL, or DIV");
                if (monthlyTxLimit !== null) {
                  const monthStart = new Date(
                    new Date().getFullYear(),
                    new Date().getMonth(),
                    1,
                  ).toISOString();
                  const { count } = await supabase
                    .from("transactions")
                    .select("id", { count: "exact", head: true })
                    .eq("org_id", thread.org_id)
                    .gte("created_at", monthStart);
                  if ((count ?? 0) >= monthlyTxLimit)
                    throw new Error(
                      `Your ${plan} plan allows ${monthlyTxLimit} transactions per month. Upgrade to Pro on the Billing page to add more.`,
                    );
                }
                if (input.quantity <= 0 || input.price <= 0)
                  throw new Error("Quantity and price must be positive");
                if (
                  !/^\d{4}-\d{2}-\d{2}$/.test(input.trade_date) ||
                  Number.isNaN(Date.parse(input.trade_date))
                )
                  throw new Error("Trade date must be a valid YYYY-MM-DD date from the source");
                const confidence = input.confidence_score ?? 0.5;
                const payload = {
                  org_id: thread.org_id,
                  ticker: input.ticker.toUpperCase(),
                  action: action as "BUY" | "SELL" | "DIV",
                  quantity: input.quantity,
                  price: input.price,
                  fees: input.fees ?? 0,
                  wht: input.wht ?? 0,
                  trade_date: input.trade_date,
                  ref_id: input.ref_id ?? "",
                  broker: input.broker ?? "",
                  exchange: input.exchange ?? "PSX",
                  currency: input.currency ?? exchangeCurrency(input.exchange ?? "PSX") ?? "USD",
                  confidence_score: confidence,
                  status: (confidence >= 0.75 ? "posted" : "needs_review") as
                    "posted" | "needs_review",
                  source: { via: "wab_agent", thread_id: thread.id },
                };
                const { data, error } = await supabase
                  .from("transactions")
                  .insert(payload)
                  .select()
                  .single();
                if (error) throw new Error(error.message);
                await audit("ai_insert_transaction", data.id, payload);
                return data;
              },
            }),
            update_transaction: tool({
              description:
                "Edit a real ledger transaction after the user reviews the proposed fields.",
              inputSchema: z.object({
                id: z.string(),
                ticker: z.string().nullable(),
                action: z.string().nullable(),
                quantity: z.number().nullable(),
                price: z.number().nullable(),
                fees: z.number().nullable(),
                wht: z.number().nullable(),
                trade_date: z.string().nullable(),
                ref_id: z.string().nullable(),
                broker: z.string().nullable(),
                exchange: z.string().nullable(),
                currency: z.string().nullable(),
                status: z.string().nullable(),
              }),
              execute: async ({ id, ...input }) => {
                const updates = Object.fromEntries(
                  Object.entries(input).filter(([, value]) => value !== null),
                );
                if (typeof updates["ticker"] === "string")
                  updates["ticker"] = updates["ticker"].toUpperCase();
                if (typeof updates["action"] === "string")
                  updates["action"] = updates["action"].toUpperCase();
                const { data, error } = await supabase
                  .from("transactions")
                  .update(updates as never)
                  .eq("id", id)
                  .eq("org_id", thread.org_id)
                  .select()
                  .single();
                if (error) throw new Error(error.message);
                await audit("ai_update_transaction", id, updates);
                return data;
              },
            }),
            delete_transaction: tool({
              description: "Delete a ledger transaction. Requires explicit user approval.",
              inputSchema: z.object({ id: z.string() }),
              execute: async ({ id }) => {
                const { error } = await supabase
                  .from("transactions")
                  .delete()
                  .eq("id", id)
                  .eq("org_id", thread.org_id);
                if (error) throw new Error(error.message);
                await audit("ai_delete_transaction", id, {});
                return { id, deleted: true };
              },
            }),
            flag_anomalies: tool({
              description:
                "Create multiple approved reconciliation flags in ONE database operation. Prefer this over repeated flag_anomaly calls when flagging several records. Use severity values low, medium, high, critical, ok, warn, or bad; they are normalized to the ledger's supported levels.",
              inputSchema: z.object({
                flags: z.array(z.object({
                  flag_type: z.string().min(1),
                  severity: z.string().nullable(),
                  ticker: z.string().min(1),
                  ref_id: z.string().nullable(),
                  expected: z.number().nullable(),
                  actual: z.number().nullable(),
                  description: z.string().min(1),
                  suggested_resolution: z.string().nullable(),
                })).min(1).max(25),
              }),
              execute: async ({ flags }) => {
                const normalizeSeverity = (value: string | null) => {
                  const level = (value ?? "warn").toLowerCase();
                  if (["critical", "high", "severe", "bad"].includes(level)) return "bad" as const;
                  if (["low", "info", "informational", "ok"].includes(level)) return "ok" as const;
                  return "warn" as const;
                };
                const tickers = [...new Set(flags.map((flag) => flag.ticker.toUpperCase()))];
                const { data: existing, error: existingError } = await supabase
                  .from("reconciliation_flags")
                  .select("flag_type,ticker,ref_id")
                  .eq("org_id", thread.org_id)
                  .eq("status", "open")
                  .in("ticker", tickers);
                if (existingError) throw new Error(existingError.message);
                const existingKeys = new Set((existing ?? []).map((flag) =>
                  `${flag.flag_type.toLowerCase()}|${flag.ticker.toUpperCase()}|${flag.ref_id ?? ""}`,
                ));
                const seen = new Set<string>();
                const rows = flags.filter((flag) => {
                  const key = `${flag.flag_type.toLowerCase()}|${flag.ticker.toUpperCase()}|${flag.ref_id ?? ""}`;
                  if (existingKeys.has(key) || seen.has(key)) return false;
                  seen.add(key);
                  return true;
                }).map((flag) => ({
                  org_id: thread.org_id,
                  flag_type: flag.flag_type,
                  severity: normalizeSeverity(flag.severity),
                  ticker: flag.ticker.toUpperCase(),
                  ref_id: flag.ref_id ?? "",
                  expected: flag.expected ?? 0,
                  actual: flag.actual ?? 0,
                  description: flag.description,
                  suggested_resolution: flag.suggested_resolution ?? "",
                  status: "open",
                }));
                if (rows.length === 0) {
                  return { created: 0, skipped_duplicates: flags.length, flags: [] };
                }
                const { data, error } = await supabase
                  .from("reconciliation_flags")
                  .insert(rows)
                  .select("id,flag_type,severity,ticker,ref_id,description,status");
                if (error) throw new Error(error.message);
                await Promise.all((data ?? []).map((flag) =>
                  audit("ai_flag_anomaly", flag.id, {
                    flag_type: flag.flag_type,
                    ticker: flag.ticker,
                    ref_id: flag.ref_id,
                    severity: flag.severity,
                  }),
                ));
                return {
                  created: data?.length ?? 0,
                  skipped_duplicates: flags.length - rows.length,
                  flags: data ?? [],
                };
              },
            }),
            flag_anomaly: tool({
              description: "Create one approved reconciliation flag. Severity accepts low, medium, high, critical, ok, warn, or bad.",
              inputSchema: z.object({
                flag_type: z.string(),
                severity: z.string().nullable(),
                ticker: z.string(),
                ref_id: z.string().nullable(),
                expected: z.number().nullable(),
                actual: z.number().nullable(),
                description: z.string(),
                suggested_resolution: z.string().nullable(),
              }),
              execute: async (input) => {
                const level = (input.severity ?? "warn").toLowerCase();
                const severity = ["critical", "high", "severe", "bad"].includes(level)
                  ? "bad"
                  : ["low", "info", "informational", "ok"].includes(level)
                    ? "ok"
                    : "warn";
                const { data, error } = await supabase
                  .from("reconciliation_flags")
                  .insert({
                    org_id: thread.org_id,
                    flag_type: input.flag_type,
                    severity,
                    ticker: input.ticker.toUpperCase(),
                    ref_id: input.ref_id ?? "",
                    expected: input.expected ?? 0,
                    actual: input.actual ?? 0,
                    description: input.description,
                    suggested_resolution: input.suggested_resolution ?? "",
                    status: "open",
                  })
                  .select()
                  .single();
                if (error) throw new Error(error.message);
                await audit("ai_flag_anomaly", data.id, input);
                return data;
              },
            }),
            resolve_flag: tool({
              description: "Mark a reconciliation flag as resolved after the user approves it.",
              inputSchema: z.object({ flag_id: z.string() }),
              execute: async ({ flag_id }) => {
                const { error } = await supabase
                  .from("reconciliation_flags")
                  .update({ status: "resolved" })
                  .eq("id", flag_id)
                  .eq("org_id", thread.org_id);
                if (error) throw new Error(error.message);
                return { id: flag_id, status: "resolved" };
              },
            }),
            report_progress: tool({
              description:
                "Publish concise user-visible progress. Use only for genuinely multi-stage work, at meaningful stage changes, and never more than 3 times per turn. Do not repeat a stage, narrate every tool call, or use this for simple questions. Never include hidden reasoning.",
              inputSchema: z.object({
                stage: z.enum([
                  "Understanding your task",
                  "Extracting financial data",
                  "Running reconciliation",
                  "Verifying evidence",
                  "Checking calculations",
                  "Delegating specialist agents",
                  "Synthesizing findings",
                  "Preparing findings",
                ]),
                detail: z.string().nullable(),
              }),
              execute: async (input) => {
                if (progressUpdatesUsed >= 3) return { ...input, suppressed: true };
                progressUpdatesUsed += 1;
                return input;
              },
            }),
            get_unfinished_records: tool({
              description:
                "Read incomplete or needs-review ledger rows so they can be completed, posted, or exported. Use this whenever the user asks to update unfinished records.",
              inputSchema: z.object({}),
              execute: async () => {
                const { data, error } = await supabase
                  .from("transactions")
                  .select(
                    "id,ticker,action,quantity,price,fees,wht,trade_date,ref_id,broker,exchange,status,confidence_score",
                  )
                  .eq("org_id", thread.org_id)
                  .order("trade_date", { ascending: false })
                  .limit(200);
                if (error) throw new Error(error.message);
                const unfinished = (data ?? []).filter((row) => {
                  const gaps = missingFields(row);
                  return (
                    row.status === "needs_review" || row.confidence_score < 0.75 || gaps.length > 0
                  );
                });
                return unfinished.map((row) => ({
                  ...row,
                  missing_fields: missingFields(row),
                  can_post: missingFields(row).length === 0,
                }));
              },
            }),
            propose_unfinished_fixes: tool({
              description:
                "Propose conservative completions for unfinished records using only existing ledger values. Does not write. Follow with update_transaction for each change the user should approve.",
              inputSchema: z.object({}),
              execute: async () => {
                const { data, error } = await supabase
                  .from("transactions")
                  .select(
                    "id,ticker,action,quantity,price,fees,wht,trade_date,ref_id,broker,exchange,status,confidence_score",
                  )
                  .eq("org_id", thread.org_id)
                  .limit(200);
                if (error) throw new Error(error.message);
                return (data ?? [])
                  .filter((row) => row.status === "needs_review" || missingFields(row).length > 0)
                  .map((row) => {
                    const missing = missingFields(row);
                    const proposed: Record<string, unknown> = { id: row.id };
                    if (row.fees == null) proposed["fees"] = 0;
                    if (row.wht == null) proposed["wht"] = 0;
                    if (!row.exchange) proposed["exchange"] = "PSX";
                    if (missing.length === 0) proposed["status"] = "posted";
                    return {
                      id: row.id,
                      ticker: row.ticker,
                      missing_fields: missing,
                      proposed_updates: proposed,
                      assumption:
                        missing.length === 0
                          ? "Required fields are present; posting is a status change only."
                          : "Required fields are still missing — do not invent values. Export a spreadsheet for the user to complete.",
                      ready_to_post: missing.length === 0,
                    };
                  });
              },
            }),
            get_tax_computation: tool({
              description:
                "Run the deterministic FIFO CGT engine on the user's real ledger. Never invent tax numbers.",
              inputSchema: z.object({
                jurisdiction: z.enum(["PSX", "NSE"]).nullable(),
                tax_year: z.string().nullable(),
              }),
              execute: async ({ jurisdiction, tax_year }) => {
                const { data, error } = await supabase
                  .from("transactions")
                  .select(
                    "id,ticker,action,quantity,price,fees,wht,trade_date,ref_id,confidence_score,status,broker,exchange",
                  )
                  .eq("org_id", thread.org_id);
                if (error) throw new Error(error.message);
                const txs = (data ?? []).map(asTransaction);
                const year = tax_year || String(new Date().getFullYear());
                const market =
                  jurisdiction ?? (txs.find((t) => t.exchange === "NSE") ? "NSE" : "PSX");
                const tax = computeTax(txs, {
                  jurisdiction: market,
                  filerStatus: "Filer",
                  taxYear: year,
                });
                return {
                  source: "DETERMINISTIC_FIFO",
                  jurisdiction: market,
                  taxYear: year,
                  shortTermGain: tax.shortTermGain,
                  longTermGain: tax.longTermGain,
                  estimatedTaxDue: tax.estimatedTaxDue,
                  dividendWHT: tax.dividendWHT,
                  lots: tax.lots.slice(0, 40),
                };
              },
            }),
            get_portfolio_analysis: tool({
              description:
                "Compute a deterministic portfolio summary from the ledger (cost-basis proxy, not live prices).",
              inputSchema: z.object({ jurisdiction: z.enum(["PSX", "NSE"]).nullable() }),
              execute: async ({ jurisdiction }) => {
                const { data, error } = await supabase
                  .from("transactions")
                  .select(
                    "id,ticker,action,quantity,price,fees,wht,trade_date,ref_id,confidence_score,status,broker,exchange",
                  )
                  .eq("org_id", thread.org_id);
                if (error) throw new Error(error.message);
                const txs = (data ?? []).map(asTransaction);
                const market =
                  jurisdiction ?? (txs.find((t) => t.exchange === "NSE") ? "NSE" : "PSX");
                return computePortfolioSummary(txs, market, String(new Date().getFullYear()));
              },
            }),
            prepare_spreadsheet: tool({
              description:
                "Build a downloadable CSV. Use kind=unfinished for rows that still need work, kind=ledger for the full book, kind=template for a blank sheet to add new records, or kind=custom with explicit rows.",
              inputSchema: z.object({
                kind: z.enum(["unfinished", "ledger", "template", "custom"]),
                filename: z.string().nullable(),
                headers: z.array(z.string()).nullable(),
                rows: z.array(z.array(z.string())).nullable(),
              }),
              execute: async ({ kind, filename, headers, rows }) => {
                const stamp = new Date().toISOString().slice(0, 10);
                if (kind === "template") {
                  const cols = headers?.length ? headers : [...LEDGER_TEMPLATE_COLUMNS];
                  return {
                    filename: filename || `psxl-new-records-${stamp}.csv`,
                    csv: toCsv(cols, [cols.map(() => "")]),
                    kind,
                    note: "Blank template for new transactions. Required columns: ticker, action, quantity, price, trade_date.",
                  };
                }
                if (kind === "custom") {
                  const cols = headers?.length ? headers : [...LEDGER_TEMPLATE_COLUMNS];
                  return {
                    filename: filename || `psxl-export-${stamp}.csv`,
                    csv: toCsv(cols, rows ?? []),
                    kind,
                  };
                }
                const { data, error } = await supabase
                  .from("transactions")
                  .select(
                    "id,ticker,action,quantity,price,fees,wht,trade_date,ref_id,broker,exchange,status,confidence_score",
                  )
                  .eq("org_id", thread.org_id)
                  .order("trade_date", { ascending: false });
                if (error) throw new Error(error.message);
                const selected =
                  kind === "unfinished"
                    ? (data ?? []).filter(
                        (row) =>
                          row.status === "needs_review" ||
                          missingFields(row).length > 0 ||
                          row.confidence_score < 0.75,
                      )
                    : (data ?? []);
                const cols = [...LEDGER_TEMPLATE_COLUMNS, "status", "confidence_score", "id"];
                const csvRows = selected.map((row) => [
                  row.ticker,
                  row.action,
                  row.quantity,
                  row.price,
                  row.fees,
                  row.wht,
                  row.trade_date,
                  row.ref_id,
                  row.broker,
                  row.exchange,
                  row.status,
                  row.confidence_score,
                  row.id,
                ]);
                return {
                  filename:
                    filename ||
                    (kind === "unfinished"
                      ? `psxl-unfinished-${stamp}.csv`
                      : `psxl-ledger-${stamp}.csv`),
                  csv: toCsv(cols, csvRows),
                  kind,
                  row_count: csvRows.length,
                };
              },
            }),
            // ── create_notification: agent can push a real in-app notification ──
            create_notification: tool({
              description:
                "Send a persistent in-app notification to the user. Use after completing a significant task, finding anomalies, or needing to alert the user. Always include a meaningful title and message.",
              inputSchema: z.object({
                type: z
                  .string()
                  .describe(
                    "Notification type: task_complete | approval_required | anomaly | error | info",
                  ),
                title: z.string().describe("Short title, max 60 chars"),
                message: z.string().describe("Full message body, 1-2 sentences"),
                severity: z.enum(["info", "success", "warning", "error"]).default("info"),
                link: z
                  .string()
                  .nullable()
                  .describe("Optional app route to link to, e.g. /app/ledger"),
              }),
              execute: async ({ type, title, message, severity, link }) => {
                await supabase.from("notifications").insert({
                  org_id: thread.org_id,
                  user_id: authData.user.id,
                  type,
                  title,
                  message,
                  severity,
                  link: link ?? null,
                });
                return { sent: true, title, type };
              },
            }),
            get_account_overview: tool({
              description:
                "Read the user's profile, organisation, plan/billing status, tax profile and record counts.",
              inputSchema: z.object({}),
              execute: async () => {
                const [prof, org, tax, txCount, flagCount, brokers] = await Promise.all([
                  supabase
                    .from("profiles")
                    .select("*")
                    .eq("user_id", authData.user.id)
                    .maybeSingle(),
                  supabase.from("organizations").select("*").eq("id", thread.org_id).maybeSingle(),
                  supabase
                    .from("tax_profiles")
                    .select("*")
                    .eq("org_id", thread.org_id)
                    .maybeSingle(),
                  supabase
                    .from("transactions")
                    .select("id", { count: "exact", head: true })
                    .eq("org_id", thread.org_id),
                  supabase
                    .from("reconciliation_flags")
                    .select("id", { count: "exact", head: true })
                    .eq("org_id", thread.org_id)
                    .eq("status", "open"),
                  supabase
                    .from("broker_accounts")
                    .select("id", { count: "exact", head: true })
                    .eq("org_id", thread.org_id),
                ]);
                return {
                  email: authData.user.email,
                  profile: prof.data,
                  organisation: org.data,
                  tax_profile: tax.data,
                  plan,
                  monthly_transaction_limit: monthlyTxLimit,
                  transactions: txCount.count ?? 0,
                  open_flags: flagCount.count ?? 0,
                  broker_accounts: brokers.count ?? 0,
                };
              },
            }),
            read_google_sheet: tool({
              description:
                "Read a Google Sheet from a link (sheet must be shared as 'Anyone with the link'). Returns CSV text.",
              inputSchema: z.object({ url: z.string() }),
              execute: async ({ url }) => {
                const m = url.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
                if (!m) throw new Error("That isn't a Google Sheets link.");
                const gid = url.match(/[#&?]gid=(\d+)/)?.[1] ?? "0";
                const res = await fetch(
                  `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`,
                  { redirect: "follow" },
                );
                if (!res.ok || !(res.headers.get("content-type") ?? "").includes("csv")) {
                  throw new Error(
                    "Couldn't open the sheet. In Google Sheets choose Share → 'Anyone with the link' and try again.",
                  );
                }
                const csv = await res.text();
                return { csv: csv.slice(0, 60000), truncated: csv.length > 60000 };
              },
            }),
            get_live_balances: tool({
              description:
                "Read live balances from connected sources (Binance, wallets, bank accounts) plus the latest synced movements. Use for questions about balances, portfolio value or what changed since the last sync.",
              inputSchema: z.object({ limit: z.number().nullable() }),
              execute: async ({ limit }) => {
                // These tables are newer than the generated Database type.
                const db = supabase as unknown as {
                  from: (table: string) => {
                    select: (columns: string) => {
                      eq: (
                        column: string,
                        value: string,
                      ) => {
                        order: (
                          column: string,
                          opts: { ascending: boolean },
                        ) => {
                          limit: (n: number) => Promise<{
                            data: unknown[] | null;
                            error: { message: string } | null;
                          }>;
                        };
                      };
                    };
                  };
                };
                const [accounts, movements] = await Promise.all([
                  db
                    .from("provider_accounts")
                    .select(
                      "connection_id,external_id,account_type,currency,balance,available,as_of,raw",
                    )
                    .eq("org_id", thread.org_id)
                    .order("as_of", { ascending: false })
                    .limit(50),
                  db
                    .from("provider_transactions")
                    .select(
                      "connection_id,kind,side,instrument,quantity,price,amount,fees,currency,occurred_at",
                    )
                    .eq("org_id", thread.org_id)
                    .order("occurred_at", { ascending: false })
                    .limit(Math.min(Math.max(limit ?? 25, 1), 100)),
                ]);
                if (accounts.error) throw new Error(accounts.error.message);
                if (movements.error) throw new Error(movements.error.message);
                return {
                  accounts: accounts.data ?? [],
                  recent_movements: movements.data ?? [],
                  note:
                    (accounts.data ?? []).length === 0
                      ? "No live source is connected yet. Connect one in Connections, then sync."
                      : "Balances are as of the last sync. Bank accounts update from their statement feed.",
                };
              },
            }),
            // ── get_broker_accounts: read broker accounts ─────────────────────
            get_broker_accounts: tool({
              description: "Read the user's connected broker accounts.",
              inputSchema: z.object({}),
              execute: async () => {
                const { data, error } = await supabase
                  .from("broker_accounts")
                  .select("id,name,broker_name,currency,exchange,external_ref,created_at")
                  .eq("org_id", thread.org_id)
                  .order("created_at", { ascending: false });
                if (error) throw new Error(error.message);
                return data ?? [];
              },
            }),
            // ── investigate_discrepancy: orchestrated investigation workflow ──
            investigate_discrepancy: tool({
              description:
                "Run an automated multi-step investigation into a specific financial discrepancy. Retrieves all related records, checks for duplicates, timing differences, fee issues, and returns a structured evidence-backed finding.",
              inputSchema: z.object({
                description: z.string().describe("What discrepancy to investigate"),
                ticker: z.string().nullable().describe("Ticker symbol if relevant"),
                ref_id: z.string().nullable().describe("Reference ID if known"),
                date_from: z.string().nullable().describe("ISO date to search from"),
                date_to: z.string().nullable().describe("ISO date to search to"),
              }),
              execute: async ({ description, ticker, ref_id, date_from, date_to }) => {
                // Step 1: Get relevant transactions
                let txQuery = supabase
                  .from("transactions")
                  .select(
                    "id,ticker,action,quantity,price,fees,wht,trade_date,ref_id,broker,exchange,status,confidence_score",
                  )
                  .eq("org_id", thread.org_id)
                  .order("trade_date", { ascending: false })
                  .limit(50);
                if (ticker) txQuery = txQuery.eq("ticker", ticker.toUpperCase());
                if (ref_id) txQuery = txQuery.ilike("ref_id", `%${ref_id}%`);
                if (date_from) txQuery = txQuery.gte("trade_date", date_from);
                if (date_to) txQuery = txQuery.lte("trade_date", date_to);
                const { data: txData } = await txQuery;

                // Step 2: Get existing flags
                const { data: flagData } = await supabase
                  .from("reconciliation_flags")
                  .select(
                    "id,flag_type,severity,ticker,ref_id,expected,actual,description,suggested_resolution,status",
                  )
                  .eq("org_id", thread.org_id)
                  .eq("status", "open")
                  .limit(20);

                // Step 3: Detect duplicates in the retrieved transactions
                const seen = new Map<string, number>();
                const duplicates: typeof txData = [];
                for (const tx of txData ?? []) {
                  const key = `${tx.ticker}|${tx.action}|${tx.quantity}|${tx.price}|${tx.trade_date}`;
                  const count = (seen.get(key) ?? 0) + 1;
                  seen.set(key, count);
                  if (count === 2) duplicates.push(tx);
                }

                // Step 4: Find low-confidence records
                const lowConfidence = (txData ?? []).filter(
                  (tx) => (tx.confidence_score ?? 1) < 0.75,
                );

                return {
                  investigation: {
                    subject: description,
                    ticker: ticker ?? "all",
                    records_examined: txData?.length ?? 0,
                    open_flags: flagData?.length ?? 0,
                  },
                  evidence: {
                    transactions: txData ?? [],
                    existing_flags: flagData ?? [],
                    duplicates_found: duplicates,
                    low_confidence_records: lowConfidence,
                  },
                  signals: {
                    has_duplicates: duplicates.length > 0,
                    has_low_confidence: lowConfidence.length > 0,
                    has_open_flags: (flagData?.length ?? 0) > 0,
                    duplicate_count: duplicates.length,
                    low_confidence_count: lowConfidence.length,
                  },
                };
              },
            }),
            // ── get_financial_health: overall org health snapshot ─────────────
            get_financial_health: tool({
              description:
                "Get a complete financial health snapshot including portfolio value, reconciliation status, active issues, and risk indicators.",
              inputSchema: z.object({}),
              execute: async () => {
                const [txResult, flagResult] = await Promise.all([
                  supabase
                    .from("transactions")
                    .select(
                      "id,ticker,action,quantity,price,fees,wht,trade_date,status,confidence_score",
                    )
                    .eq("org_id", thread.org_id)
                    .order("trade_date", { ascending: false })
                    .limit(500),
                  supabase
                    .from("reconciliation_flags")
                    .select("id,severity,status,description")
                    .eq("org_id", thread.org_id)
                    .eq("status", "open"),
                ]);

                const txs = txResult.data ?? [];
                const flags = flagResult.data ?? [];

                const buys = txs.filter((t) => t.action === "BUY");
                const sells = txs.filter((t) => t.action === "SELL");
                const needsReview = txs.filter((t) => t.status === "needs_review");
                const lowConf = txs.filter((t) => (t.confidence_score ?? 1) < 0.75);
                const criticalFlags = flags.filter((f) => f.severity === "bad");
                const warnFlags = flags.filter((f) => f.severity === "warn");

                const totalBuyValue = buys.reduce(
                  (s, t) => s + Number(t.price) * Number(t.quantity),
                  0,
                );
                const totalSellValue = sells.reduce(
                  (s, t) => s + Number(t.price) * Number(t.quantity),
                  0,
                );
                const totalFees = txs.reduce(
                  (s, t) => s + Number(t.fees ?? 0) + Number(t.wht ?? 0),
                  0,
                );

                const uniqueTickers = [...new Set(txs.map((t) => t.ticker))];

                return {
                  summary: {
                    total_transactions: txs.length,
                    buys: buys.length,
                    sells: sells.length,
                    unique_tickers: uniqueTickers.length,
                    needs_review: needsReview.length,
                    low_confidence: lowConf.length,
                  },
                  financial: {
                    total_buy_value: totalBuyValue,
                    total_sell_value: totalSellValue,
                    net_exposure: totalBuyValue - totalSellValue,
                    total_fees_and_wht: totalFees,
                    tickers: uniqueTickers.slice(0, 20),
                  },
                  health: {
                    open_critical_flags: criticalFlags.length,
                    open_warning_flags: warnFlags.length,
                    total_open_flags: flags.length,
                    critical_issues: criticalFlags.map((f) => f.description).slice(0, 5),
                    health_score: Math.max(
                      0,
                      100 -
                        criticalFlags.length * 20 -
                        warnFlags.length * 5 -
                        needsReview.length * 2,
                    ),
                  },
                };
              },
            }),
          };

          // Keep the model's tool context lean. Basic and Standard accounts only
          // receive tools their plan can actually use; specialist/background and
          // external integrations are loaded only for Pro.
          const basicToolNames = new Set([
            "calculate",
            "get_latest_trade_metrics",
            "get_transactions",
            "get_ledger_summary",
            "get_open_flags",
            "insert_transaction",
            "update_transaction",
            "flag_anomaly",
            "flag_anomalies",
            "resolve_flag",
            "get_unfinished_records",
            "get_tax_computation",
            "get_portfolio_analysis",
            "prepare_spreadsheet",
            "get_account_overview",
            "get_broker_accounts",
            "get_financial_health",
          ]);
          const standardToolNames = new Set([
            ...basicToolNames,
            "investigate_discrepancy",
            "propose_unfinished_fixes",
          ]);
          const enabledTools = (plan === "pro"
            ? tools
            : Object.fromEntries(
                Object.entries(tools).filter(([name]) =>
                  (plan === "standard" ? standardToolNames : basicToolNames).has(name),
                ),
              )) as typeof tools;

          const lastUser = [...uiMessages].reverse().find((m) => m.role === "user");
          const latestText = (lastUser?.parts ?? [])
            .map((p) => (p.type === "text" ? p.text : ""))
            .join(" ");
          const title = text(latestText).slice(0, 64) || "Document audit";
          // Spreadsheets/text files can't go to the model as files — turn them into text tables.
          // Keep the prompt context bounded. The complete thread remains persisted
          // in Supabase and visible in the UI; only the latest 10 messages are sent
          // to the model so old tool payloads cannot grow the context indefinitely.
          const modelContextMessages = uiMessages.slice(-10);
          const modelMessages = await convertToModelMessages(modelContextMessages);

          // Groq's OpenAI-compatible chat endpoint rejects reasoning_content.
          // The AI SDK may restore this from assistant provider metadata even if
          // it was removed from the converted message object. Strip reasoning
          // parts, provider metadata, and snake/camel reasoning payload fields
          // from assistant history before passing it to any Groq model.
          const stripGroqReasoningFields = (value: unknown): unknown => {
            if (Array.isArray(value)) {
              return value.map(stripGroqReasoningFields);
            }
            if (value && typeof value === "object") {
              const entries = Object.entries(value as Record<string, unknown>)
                .filter(
                  ([key]) =>
                    key !== "reasoning_content" &&
                    key !== "reasoningContent" &&
                    key !== "reasoning",
                )
                .map(([key, nested]) => [key, stripGroqReasoningFields(nested)]);
              return Object.fromEntries(entries);
            }
            return value;
          };

          const cleanedMessages = modelMessages.map((message) => {
            if (message.role !== "assistant") {
              return stripGroqReasoningFields(message) as typeof message;
            }
            const { providerMetadata: _providerMetadata, ...assistantMessage } =
              message as typeof message & {
                providerMetadata?: unknown;
              };
            const withoutReasoningParts = {
              ...assistantMessage,
              content: Array.isArray(assistantMessage.content)
                ? assistantMessage.content.filter((part) => part.type !== "reasoning")
                : assistantMessage.content,
            };
            return stripGroqReasoningFields(withoutReasoningParts) as typeof message;
          });

          // tries the next free model whenever a provider/quota error is thrown
          // during the initial connection (before any bytes are streamed).

          const modelCascade = resolved.cascade;

          // Tell the model which entitlements apply so it never promises a
          // capability the user's plan doesn't include.
          const planSection = `

━━ ACCOUNT ━━
The user is on the ${limits.name} plan (id: ${plan}). AI quality is ${limits.aiQuality}. Basic ($0) is limited in features, variety and answer depth — keep replies shorter and use fewer tools. Standard has a 7-day trial only. Pro unlocks the full tool set. If the user asks for a capability their plan doesn't include, answer what you can and mention the upgrade briefly — never block reads.`;

          const SYSTEM_PROMPT = `You are ${ASSISTANT_NAME}, the native AI assistant built into ${BRAND_NAME}. You are a financial operations assistant, not a foundation model. If asked who you are, identify yourself as ${ASSISTANT_NAME}, built into ${BRAND_NAME}. If asked which model powers you, be transparent that ${BRAND_NAME} routes requests through its configured AI providers; never misrepresent the underlying model or provider.

You are a fast, precise financial audit agent for PSX and NSE traders. You are connected to the user's real ledger, portfolio, profile, account, broker accounts, tax figures and reconciliation flags. When the user attaches a file, it is in the message — read it. Never claim no file was attached if a file part or an "Attached file" block is present.

━━ SPEED AND EFFICIENCY (most important) ━━
- Answer greetings, definitions and general questions directly with NO tools.
- Use the fewest tools possible. Call independent read tools together in one step. Never call the same tool twice with the same input. For multiple ledger flags, use flag_anomalies once with all records rather than repeated flag_anomaly calls. Do not retry a failed write blindly; inspect the returned error and correct the input first. For simple questions, do not plan, report progress, or delegate. For multi-step work, publish at most one plan and at most three meaningful progress updates total; never repeat a stage or narrate each individual tool call. As soon as the required evidence is available, stop calling tools and write the final answer.
- Answer simple questions with no plan, no delegation, and the minimum necessary tools. For non-trivial work, plan first and report meaningful stage changes.
- For complex audits only, use delegate_agents to send 2–4 distinct, independent read-only subtasks in parallel. Publish the "Delegating specialist agents" progress stage before dispatch, wait for the results, then publish "Synthesizing findings" and verify important claims against ledger/tool data. Provide a precise scope and relevant evidence to each worker. Do not delegate the same question twice, do not fan out dependent steps, and continue safely if one specialist is unavailable; disclose incomplete review instead of implying every agent succeeded. Keep deterministic calculations and every ledger write in the lead agent's typed tools.
- Keep answers concise, polished, and easy to scan—ChatGPT-style conversational formatting. Use Markdown with clean paragraph spacing, meaningful headings only when useful, bold key figures/labels, and compact tables for financial metrics/comparisons. Prefer clear human-readable labels over raw JSON keys or tool output. Avoid wall-of-text responses, excessive headings, repetitive summaries, and unrequested technical dumps. For a single metric lookup, lead with the answer and provide a small organized metric table plus source/caveat. Use the structured report sections only for real audits/analysis; otherwise answer in a few short paragraphs or a table.
- Always finish with a complete written answer.
- After every tool call you MUST continue and write a plain-English answer in the same turn. Never stop after tools. Never leave the user with only JSON, raw tool output, or a silent tool card.
- For balance, holdings, ledger totals, tax, or account questions: state the figures in short sentences (amount + currency + source). If nothing is connected, say that plainly.

━━ GROUNDED SYMBOL ANALYSIS ━━
- If the user names a ticker (for example OGDC), immediately call get_transactions with that exact ticker and a sufficient limit before answering. Never conclude that the symbol has no data based on market-data lookup alone; the user's own ledger is the primary source.
- Analyse the stored rows directly: buys/sells/dividends, quantities, dates, prices, fees and WHT; calculate supported ledger totals and describe the transaction history for the named ticker.
- Distinguish ledger analysis from live market research. If live quote/history or external company fundamentals are unavailable, say which external field is unavailable while still analysing the ledger. Never return a generic “no data for this found” response when ledger rows exist.
- Avoid unrelated boilerplate, generic investing advice, and unsupported claims. Anchor each insight to a specific ledger fact and date. If the ticker query returns zero rows, verify via get_ledger_summary tickers before concluding no matching records.
- For portfolio/trading-performance analytics, compute from the user's stored trades where the necessary fields exist; label unavailable metrics (such as MAE/MFE, stop adherence, intraday hour/session, market regime, slippage, equity history) as “not captured in ledger” rather than fabricating them.

━━ DATA ━━
- Account/profile/plan/organisation → get_account_overview
- Latest trade metrics → get_latest_trade_metrics; ledger rows → get_transactions; totals → get_ledger_summary; holdings/portfolio → get_portfolio_analysis
- Tax → get_tax_computation; issues → get_open_flags; incomplete rows → get_unfinished_records; brokers → get_broker_accounts
- Connected exchanges/wallets/banks, live balances or “what changed” → get_live_balances
- Google Sheets link in the message → read_google_sheet, then analyse or import the rows
- Uploaded Excel/CSV files arrive as text tables in the message — read them directly. For a broker statement or trade-confirmation upload where the user requests import/posting (including the default upload action), extract each supported transaction row and use insert_transaction for each valid row so it appears in the real ledger. Do not stop at summarizing/extracting: after inserts, report how many records were posted and list any rows withheld because required fields were missing or uncertain. Never guess missing ticker, action, quantity, price or trade date; ask for clarification or clearly hold those rows. If the attachment is not a transaction statement, do not post it.
- Normalize exchange values as exchange codes/names from the source (examples: PSX, NSE, NYSE, NASDAQ, LSE, HKEX, XETRA, TSE, ASX); the ledger supports arbitrary exchange codes.
- Use calculate for material numbers. Never guess ledger contents.

━━ ACTING ━━
- Act directly. Do NOT ask "should I proceed?" — when the user asks to add, import, update, flag or resolve, just do it and report what changed.
- insert_transaction, update_transaction, flag_anomaly and resolve_flag run immediately and are recorded in the audit trail.
- Only delete_transaction asks the user to confirm (the app shows the button). Never ask for confirmation in text.
- Never invent missing ticker, quantity, price or date — say which fields are missing.
- Spreadsheet exports: prepare_spreadsheet (downloads a CSV that opens in Excel and Google Sheets).

━━ AUDIT REPORT FORMAT (only for real analysis) ━━
## Summary / ## Key Findings / ## Discrepancies / ## Recommended Actions / ## Confidence Level
Mark figures as verified (with source) or assumption. Use markdown tables. Never reveal hidden reasoning.

NEW TOOLS ADDED:
- investigate_discrepancy: automated multi-step investigation — use this when user reports a mismatch, duplicate, or unexplained difference. Returns structured evidence (transactions, flags, duplicates, low-confidence records).
- get_financial_health: full org health snapshot (totals, flags, health score) — use for "give me an overview" / "what needs attention" queries.\n- get_latest_trade_metrics: deterministic latest ledger trade figures (gross value, charges, net cash impact).`;

          const STREAM_OPTS = {
            system: SYSTEM_PROMPT + planSection,
            messages: cleanedMessages,
            tools: enabledTools,
            // Only destructive deletes need a confirmation; everything else is audited.
            toolApproval: plan === "pro" ? {
              delete_transaction: "user-approval" as const,
            } : {},
            experimental_toolApprovalSecret: approvalSecret,
            // AI SDK 7 ignores maxSteps; without stopWhen the loop ends after the
            // first tool call and the user never gets a written answer.
            stopWhen: stepCountIs(maxSteps),
            maxOutputTokens: limits.aiQuality === "limited" ? 900 : limits.aiQuality === "standard" ? 1800 : 3200,
            // Groq on-demand frequently returns transient TPM 429s with a
            // short retry-after window. Allow the SDK's exponential backoff to
            // retry before we declare this provider unavailable and fail over.
            maxRetries: 1,
            // Keep a hard tool-step ceiling without forcing toolChoice:none.
            // Some compatible providers still emit tool calls when forced to none,
            // which causes "Tool choice is none, but model called a tool".
            providerOptions: resolved.providerOptions as never,
          };

          const persistMessages = async (messages: UIMessage[]) => {
            try {
              const seen = new Map<string, UIMessage & { position: number }>();
              messages.forEach((message, index) => {
                seen.set(message.id, { ...message, position: index });
              });
              const deduped = Array.from(seen.values());
              await supabase.from("chat_messages").upsert(
                deduped.map((message) => ({
                  thread_id: thread.id,
                  org_id: thread.org_id,
                  user_id: authData.user.id,
                  ai_message_id: message.id,
                  role: message.role,
                  parts: message.parts as never,
                  position: message.position,
                })),
                { onConflict: "thread_id,ai_message_id" },
              );
              await supabase
                .from("chat_threads")
                .update({ title, updated_at: new Date().toISOString() })
                .eq("id", thread.id)
                .eq("user_id", authData.user.id);
            } catch {
              // Persistence must never break the reply.
            }
          };

          // Prefer models that passed the live probe. In particular, do not
          // send a complex tool request first to a provider already known to be
          // unavailable just because it appeared earlier in configuration.
          const failoverQueue = [
            chosenModel,
            ...resolved.cascade.filter(
              (entry) => entry.provider !== chosenModel.provider || entry.modelId !== chosenModel.modelId,
            ),
          ];

          // One place that turns any failure into a safe, categorised message.
          // The underlying error is always logged server-side so the real cause
          // can be found in the hosting logs.
          const describeStreamError = (e: unknown, where: string): string => {
            console.error(
              `[${BRAND_NAME} Chat] ${where} error:`,
              e instanceof Error ? (e.stack ?? e.message) : e,
            );
            const errorRecord = (e ?? {}) as { statusCode?: number; status?: number; message?: string; name?: string };
            const st = errorRecord.statusCode ?? errorRecord.status;
            const rawMessage = String(errorRecord.message ?? e ?? "Unknown provider error");
            const lowerMessage = rawMessage.toLowerCase();
            if (errorRecord.name === "AbortError" || lowerMessage.includes("aborted"))
              return "Response stopped.";
            if (st === 402)
              return "AI credits are used up. Add credits in your workspace settings to continue.";
            if (st === 401)
              return "AI authentication failed. Please check the provider API key configuration.";
            if (st === 403)
              return "AI access is blocked for this workspace. Please check the provider settings.";
            if (isCapacityError(e) || st === 429 || lowerMessage.includes("rate limit")) {
              return brandText("{{brand}} AI has temporarily hit a provider rate limit. Your data was not changed — please retry shortly.");
            }
            if (st === 404 || lowerMessage.includes("model not found"))
              return "The configured AI model is unavailable from its provider. Please try again shortly.";
            if (st === 408 || st === 504 || lowerMessage.includes("timeout") || lowerMessage.includes("timed out"))
              return "The AI provider timed out before completing the response. Your data was not changed — please retry.";
            if (st === 400 && (lowerMessage.includes("context") || lowerMessage.includes("token")))
              return "This request is too large for the selected AI model. Try a shorter prompt or fewer attached documents.";
            // Surface a short, sanitized diagnostic instead of hiding every failure behind
            // the same generic message. Never echo authorization credentials.
            const safeMessage = rawMessage
              .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
              .replace(/sk-or-v1-[A-Za-z0-9]+/gi, "[redacted key]")
              .replace(/https?:\/\/\S+/gi, "[provider URL]")
              .slice(0, 180);
            return brandText("{{brand}} AI could not finish this response: " + safeMessage);
          };

          const stream = createUIMessageStream({
            originalMessages: body.messages as UIMessage[],
            execute: async ({ writer }) => {
              let lastError: unknown;
              for (const entry of failoverQueue) {
                let candidate:
                  | {
                      result: ReturnType<typeof streamText<typeof tools>>;
                      iterator: AsyncIterator<UIMessageChunk>;
                      first: IteratorResult<UIMessageChunk>;
                    }
                  | undefined;
                try {
                  const result = streamText({
                    model: entry.model,
                    ...STREAM_OPTS,
                    providerOptions: entry.providerOptions as never,
                  });
                  // Without onError the SDK masks every mid-stream failure as the
                  // generic "An error occurred." — surface a real message instead.
                  const ui = result.toUIMessageStream({
                    sendReasoning: false,
                    onError: (e) =>
                      describeStreamError(e, `mid-stream (${entry.provider}/${entry.modelId})`),
                  });
                  const iterator = ui[Symbol.asyncIterator]();
                  const first = await iterator.next();
                  candidate = { result, iterator, first };
                } catch (error) {
                  lastError = error;
                  markProviderUnhealthy(
                    entry.provider,
                    entry.modelId,
                    error instanceof Error ? error.message : String(error),
                  );
                  console.warn(
                    `[${BRAND_NAME} Chat] ${entry.provider}/${entry.modelId} failed before stream start; trying next provider:`,
                    error instanceof Error ? error.message : error,
                  );
                  continue;
                }

                if (!candidate) continue;

                const chunk = candidate.first.value as
                  { type?: string; errorText?: string } | undefined;
                if (chunk?.type === "error") {
                  const err = new Error(chunk.errorText ?? "Provider returned an error");
                  lastError = err;
                  markProviderUnhealthy(entry.provider, entry.modelId, err.message);
                  console.warn(
                    `[${BRAND_NAME} Chat] ${entry.provider}/${entry.modelId} rejected the request before stream start; trying next provider:`,
                    err.message,
                  );
                  await candidate.iterator.return?.();
                  continue;
                }

                console.log(brandText("[{{brand}} Chat] streaming with"), entry.provider, entry.modelId);
                writer.merge(replayIteratorStream(candidate.first, candidate.iterator));
                // Once output starts, do not replay on another provider: a tool
                // may already have changed user data, and replay could duplicate it.
                await candidate.result.response;
                return;
              }
              throw lastError instanceof Error
                ? lastError
                : new Error("Every AI provider is busy. Please try again in a moment.");
            },
            onError: (e) => describeStreamError(e, "stream"),
            onFinish: async ({ messages }) => {
              await persistMessages(messages);
            },
          });

          return createUIMessageStreamResponse({ stream });
        } catch (error) {
          // Return more detailed error for debugging
          const errorMessage = error instanceof Error ? error.message : String(error);
          const errorStack = error instanceof Error ? error.stack : undefined;
          console.error(brandText("[{{brand}} Chat] Internal Error:"), {
            message: errorMessage,
            stack: errorStack,
            error,
          });

          return new Response(
            JSON.stringify({
              code: "internal_error",
              message: "An internal error occurred. Please try again.",
              error: errorMessage,
            }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    }) as never,
  },
});
