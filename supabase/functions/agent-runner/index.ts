// ─── Wab Agent Runner — Supabase Edge Function ────────────────────────────
// Deno runtime. Dequeues one job, runs it, handles retries and invariant checks.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { computeTax } from "../../src/lib/tax.ts";
import { suggestHarvesting } from "../../src/lib/tax.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const OPENROUTER_KEY = Deno.env.get("OPENROUTER_API_KEY") ?? "";
const OPENROUTER_MODEL = Deno.env.get("OPENROUTER_MODEL") ?? "openai/gpt-4o-mini";

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── Extraction JSON schema for structured outputs ─────────────────────────────
const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    transaction_date: { type: ["string", "null"] },
    ticker: { type: ["string", "null"] },
    action: { type: ["string", "null"], enum: ["BUY", "SELL", "DIV", null] },
    quantity: { type: ["number", "null"] },
    price: { type: ["number", "null"] },
    fees: { type: ["number", "null"] },
    wht: { type: ["number", "null"] },
    ref_id: { type: ["string", "null"] },
    broker: { type: ["string", "null"] },
    exchange: { type: ["string", "null"] },
    field_confidences: { type: "object" },
  },
  required: ["field_confidences"],
};

// ── Call OpenRouter with JSON schema enforcement ──────────────────────────────
async function callLLM(
  systemPrompt: string,
  userContent: string | Array<Record<string, unknown>>,
  schema?: Record<string, unknown>,
): Promise<unknown> {
  if (!OPENROUTER_KEY) throw new Error("OPENROUTER_API_KEY not set");

  const body: Record<string, unknown> = {
    model: OPENROUTER_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    temperature: 0.1,
    max_tokens: 1024,
  };

  if (schema) {
    body["response_format"] = {
      type: "json_schema",
      json_schema: { name: "extraction", strict: true, schema },
    };
  }

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://psxl.live",
      "X-Title": "Wab",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    throw new Error(`OpenRouter ${res.status}: ${txt}`);
  }

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const raw = data.choices?.[0]?.message?.content ?? "{}";

  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

// ── Deterministic CSV row extractor (no LLM) ──────────────────────────────────
function extractCSVRows(csv: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i]!;
    if (quoted && ch === '"' && csv[i + 1] === '"') {
      cell += '"';
      i++;
    } else if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && csv[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some((value) => value !== "")) rows.push(row);
  if (rows.length < 2) return [];
  const delimiter = rows[0]!.filter((value) => value.includes("\t")).length > 0 ? "\t" : ",";
  // TSV is passed through the same parser by converting its delimiter before tokenizing.
  if (delimiter === "\t") return extractCSVRows(csv.replace(/\t/g, ","));
  const headers = rows[0]!.map((h) =>
    h
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, ""),
  );
  return rows
    .slice(1)
    .map((values) => Object.fromEntries(headers.map((header, i) => [header, values[i] ?? ""])));
}

function normalizeTradeDate(input: string): string {
  const value = input.trim();
  let year = 0;
  let month = 0;
  let day = 0;
  let match = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (match) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else {
    match = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (!match) return "";
    const first = Number(match[1]);
    const second = Number(match[2]);
    // An ambiguous 04/05/2026 needs review rather than a guessed date.
    if (first <= 12 && second <= 12) return "";
    if (first > 12) {
      day = first;
      month = second;
    } else {
      month = first;
      day = second;
    }
    year = Number(match[3]);
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ── Invariant checks (plain code) ─────────────────────────────────────────────
async function checkInvariants(orgId: string, runId: string): Promise<string[]> {
  const failures: string[] = [];

  const { data: txs } = await db
    .from("transactions")
    .select("id, ticker, action, quantity")
    .eq("org_id", orgId)
    .filter("source->>'agent_run_id'", "eq", runId);

  for (const tx of txs ?? []) {
    if (Number(tx.quantity) <= 0) failures.push(`quantity<=0 on ${tx.id}`);
  }

  // Inventory check
  const { data: all } = await db
    .from("transactions")
    .select("ticker, action, quantity")
    .eq("org_id", orgId)
    .order("trade_date");

  const inv: Record<string, number> = {};
  for (const tx of all ?? []) {
    inv[tx.ticker as string] =
      (inv[tx.ticker as string] ?? 0) +
      (tx.action === "BUY" ? Number(tx.quantity) : tx.action === "SELL" ? -Number(tx.quantity) : 0);
  }
  for (const [ticker, net] of Object.entries(inv)) {
    if (net < -0.0001) failures.push(`oversell: ${ticker} net=${net}`);
  }

  return failures;
}

// ── Loop-prevention: did the agent cause this source change? ──────────────────
async function wasAgentWrite(orgId: string, sourceHash: string): Promise<boolean> {
  // Check if any recently completed job for this org produced a transaction
  // whose source.agent_run_id is known — if the hash matches, skip.
  const { data: recent } = await db
    .from("agent_jobs")
    .select("run_id, result_summary")
    .eq("org_id", orgId)
    .eq("status", "done")
    .gte("updated_at", new Date(Date.now() - 5 * 60 * 1000).toISOString())
    .limit(10);

  for (const job of recent ?? []) {
    const summary = job.result_summary as Record<string, unknown> | null;
    if (summary?.["output_hash"] === sourceHash) return true;
  }
  return false;
}

// ── Post a notification ───────────────────────────────────────────────────────
async function notify(
  orgId: string,
  type: string,
  title: string,
  message: string,
  severity: "info" | "success" | "warning" | "error" = "info",
  link?: string,
): Promise<void> {
  // Get first owner user_id for this org
  const { data: profile } = await db
    .from("profiles")
    .select("user_id")
    .eq("org_id", orgId)
    .eq("role", "owner")
    .maybeSingle();

  if (!profile) return;

  await db.from("notifications").insert({
    org_id: orgId,
    user_id: profile.user_id,
    type,
    title,
    message,
    severity,
    link: link ?? null,
  } as never);
}

// ── Handle: nightly reconciliation ────────────────────────────────────────────
async function handleNightlyReconcile(
  orgId: string,
  runId: string,
): Promise<Record<string, unknown>> {
  const { data: txs } = await db
    .from("transactions")
    .select(
      "id, ticker, action, quantity, price, fees, wht, trade_date, ref_id, broker, exchange, status",
    )
    .eq("org_id", orgId)
    .order("trade_date");

  if (!txs?.length) return { processed: 0, flags: 0 };

  // Detect duplicates: same (ticker, trade_date, quantity, price, action)
  const seen = new Map<string, string>();
  let flagCount = 0;

  for (const tx of txs) {
    const key = `${tx.ticker}|${tx.trade_date}|${tx.quantity}|${tx.price}|${tx.action}`;
    if (seen.has(key)) {
      // Flag the duplicate
      const { error } = await db.from("reconciliation_flags").insert({
        org_id: orgId,
        flag_type: "Duplicate Entry",
        severity: "warn",
        ticker: tx.ticker,
        ref_id: tx.ref_id ?? "",
        expected: { ref_id: seen.get(key) } as never,
        actual: { ref_id: tx.id } as never,
        description: `Duplicate transaction detected: ${tx.ticker} ${tx.action} ${tx.quantity} @ ${tx.price} on ${tx.trade_date}`,
        suggested_resolution: "Review and remove one of the duplicate entries.",
        status: "open",
      } as never);

      if (!error) flagCount++;
    } else {
      seen.set(key, tx.id);
    }
  }

  // Mark unreconciled rows that are missing key fields
  const missingRef = txs.filter((t) => !t.ref_id || t.ref_id === "");
  for (const tx of missingRef) {
    await db
      .from("transactions")
      .update({ status: "needs_review" } as never)
      .eq("id", tx.id);
  }

  await notify(
    orgId,
    "reconciliation_complete",
    "Nightly reconciliation done",
    `Processed ${txs.length} transactions, found ${flagCount} flag(s).`,
    flagCount > 0 ? "warning" : "success",
    "/app/reconciliation",
  );

  return { processed: txs.length, flags: flagCount };
}

// ── Handle: monthly tax run ───────────────────────────────────────────────────
async function handleMonthlyTaxRun(orgId: string): Promise<Record<string, unknown>> {
  const { data: txRows } = await db
    .from("transactions")
    .select(
      "id,ticker,action,quantity,price,fees,wht,trade_date,ref_id,confidence_score,status,broker,exchange",
    )
    .eq("org_id", orgId);

  const { data: org } = await db
    .from("organizations")
    .select("jurisdiction_default")
    .eq("id", orgId)
    .maybeSingle();

  const jurisdiction = (org?.jurisdiction_default ?? "PSX") as "PSX" | "NSE";
  const taxYear = String(new Date().getFullYear());
  const txs = (txRows ?? []).map((r) => ({
    id: r.id,
    ticker: r.ticker,
    action: r.action as "BUY" | "SELL" | "DIV",
    quantity: Number(r.quantity),
    price: Number(r.price),
    fees: Number(r.fees ?? 0),
    wht: Number(r.wht ?? 0),
    trade_date: r.trade_date,
    ref_id: r.ref_id,
    confidence_score: Number(r.confidence_score ?? 1),
    status: r.status as "posted" | "needs_review",
    broker: r.broker,
    exchange: (r.exchange === "NSE" ? "NSE" : "PSX") as "PSX" | "NSE",
  }));

  const tax = computeTax(txs, { jurisdiction, filerStatus: "Filer", taxYear });

  await db.from("tax_computations").insert({
    org_id: orgId,
    tax_year: taxYear,
    jurisdiction,
    filer_status: "Filer",
    short_term_gain: tax.shortTermGain,
    long_term_gain: tax.longTermGain,
    dividend_wht: tax.dividendWHT,
    estimated_tax_due: tax.estimatedTaxDue,
    breakdown: { lots: tax.lots.slice(0, 50) } as never,
  } as never);

  // Harvesting suggestions
  const suggestions = suggestHarvesting(txs, tax.totalGain);
  for (const s of suggestions.slice(0, 10)) {
    await db
      .from("tax_loss_harvest_suggestions")
      .insert({
        org_id: orgId,
        position_ticker: s.ticker,
        exchange: s.exchange,
        unrealized_loss: s.unrealizedLoss,
        potential_offset: s.potentialOffset,
        holding_days: s.holdingDays,
        rationale: s.rationale,
        status: "pending",
      } as never)
      .then(
        () => undefined,
        () => undefined,
      );
  }

  await notify(
    orgId,
    "tax_run_complete",
    "Monthly tax computation complete",
    `Est. tax due: ${jurisdiction === "PSX" ? "PKR" : "INR"} ${tax.estimatedTaxDue.toLocaleString()}`,
    "info",
    "/app/tax",
  );

  return { tax_year: taxYear, estimated_tax_due: tax.estimatedTaxDue, lots: tax.lots.length };
}

// ── Handle: document/CSV ingestion ───────────────────────────────────────────
async function handleIngestion(
  orgId: string,
  runId: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const documentId = typeof payload["document_id"] === "string" ? payload["document_id"] : null;
  const storagePath = typeof payload["storage_path"] === "string" ? payload["storage_path"] : null;
  const filename = typeof payload["filename"] === "string" ? payload["filename"] : "statement.csv";
  let csvContent = typeof payload["csv"] === "string" ? payload["csv"] : "";
  if (storagePath) {
    const { data: file, error } = await db.storage.from("documents").download(storagePath);
    if (error || !file)
      throw new Error(`Could not read uploaded document: ${error?.message ?? "empty file"}`);
    const ext = filename.split(".").pop()?.toLowerCase();
    if (ext === "xlsx" || ext === "xls") {
      const XLSX = await import("https://esm.sh/xlsx@0.18.5");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      csvContent = workbook.SheetNames.map((name) =>
        XLSX.utils.sheet_to_csv(workbook.Sheets[name]!),
      ).join("\n");
    } else if (ext === "csv" || ext === "txt" || ext === "tsv") {
      csvContent = await file.text();
    } else if (
      ext === "pdf" ||
      ext === "png" ||
      ext === "jpg" ||
      ext === "jpeg" ||
      ext === "webp"
    ) {
      const apiKey = Deno.env.get("OPENROUTER_API_KEY") ?? "";
      if (!apiKey)
        throw new Error("Document AI is not configured (OPENROUTER_API_KEY is missing).");
      if (file.size > 10 * 1024 * 1024)
        throw new Error("PDF and image extraction is limited to 10 MB per file.");
      const mimeType =
        ext === "pdf"
          ? "application/pdf"
          : ext === "png"
            ? "image/png"
            : ext === "webp"
              ? "image/webp"
              : "image/jpeg";
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 0x8000)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      const dataUrl = `data:${mimeType};base64,${btoa(binary)}`;
      const filePart =
        ext === "pdf"
          ? { type: "file", file: { filename, file_data: dataUrl } }
          : { type: "image_url", image_url: { url: dataUrl } };
      const parsed = (await callLLM(
        "Extract trade rows from this financial statement. Return only fields clearly supported by the source; never infer missing values. Output JSON with a transactions array; each item has ticker, action (BUY/SELL/DIV), quantity, price, fees, wht, trade_date (YYYY-MM-DD), ref_id, broker, exchange, and confidence_score (0 to 1 reflecting visible evidence). Use null for unavailable fields.",
        [{ type: "text", text: `Read ${filename} and extract all transaction rows.` }, filePart],
        {
          type: "object",
          properties: {
            transactions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  ticker: { type: ["string", "null"] },
                  action: { type: ["string", "null"] },
                  quantity: { type: ["number", "null"] },
                  price: { type: ["number", "null"] },
                  fees: { type: ["number", "null"] },
                  wht: { type: ["number", "null"] },
                  trade_date: { type: ["string", "null"] },
                  ref_id: { type: ["string", "null"] },
                  broker: { type: ["string", "null"] },
                  exchange: { type: ["string", "null"] },
                  confidence_score: { type: "number", minimum: 0, maximum: 1 },
                },
                required: [
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
                  "confidence_score",
                ],
                additionalProperties: false,
              },
            },
          },
          required: ["transactions"],
          additionalProperties: false,
        },
      )) as { transactions?: Array<Record<string, unknown>> };
      const aiRows = (parsed.transactions ?? []).map((item) =>
        Object.fromEntries(
          Object.entries(item).map(([key, val]) => [key, val == null ? "" : String(val)]),
        ),
      );
      csvContent = [
        Object.keys(aiRows[0] ?? {}).join(","),
        ...aiRows.map((row) =>
          Object.values(row)
            .map((value) => `"${value.replace(/"/g, '""')}"`)
            .join(","),
        ),
      ].join("\n");
    } else {
      const message = `Automatic ledger import does not support ${ext ?? "this file type"}.`;
      if (documentId)
        await db
          .from("documents")
          .update({ status: "failed", extracted_data: { filename, error: message } as never })
          .eq("id", documentId)
          .eq("org_id", orgId);
      throw new Error(message);
    }
  }
  if (!csvContent) {
    const message = `No readable transaction content was extracted from ${filename}.`;
    if (documentId)
      await db
        .from("documents")
        .update({ status: "failed", extracted_data: { filename, error: message } as never })
        .eq("id", documentId)
        .eq("org_id", orgId);
    throw new Error(message);
  }

  const rows = extractCSVRows(csvContent);
  if (rows.length === 0) {
    const message = `No transaction rows could be extracted from ${filename}. Check that the file has a header row and supported transaction columns.`;
    if (documentId)
      await db
        .from("documents")
        .update({ status: "failed", extracted_data: { filename, error: message } as never })
        .eq("id", documentId)
        .eq("org_id", orgId);
    throw new Error(message);
  }
  let inserted = 0;
  let skipped = 0;
  const extracted: Array<Record<string, unknown>> = [];
  const aliases: Record<string, string[]> = {
    ticker: ["ticker", "symbol", "instrument", "security"],
    action: ["action", "type", "side", "trade_type"],
    quantity: ["quantity", "qty", "shares", "units"],
    price: ["price", "execution_price", "average_price"],
    trade_date: ["trade_date", "date", "transaction_date", "trade_time"],
    ref_id: ["ref_id", "reference", "reference_id", "order_id", "trade_id", "id"],
    confidence_score: ["confidence_score"],
    fees: ["fees", "commission", "brokerage", "charges"],
    wht: ["wht", "tax", "withholding", "withholding_tax"],
    broker: ["broker", "broker_name"],
    exchange: ["exchange", "market"],
  };
  const value = (row: Record<string, string>, key: string) =>
    aliases[key]!.map((name) => row[name])
      .find((v) => v?.trim())
      ?.trim() ?? "";
  for (const row of rows) {
    const ticker = value(row, "ticker").toUpperCase();
    const rawAction = value(row, "action").toUpperCase();
    const action =
      (
        { PURCHASE: "BUY", BOUGHT: "BUY", SALE: "SELL", SOLD: "SELL", DIVIDEND: "DIV" } as Record<
          string,
          string
        >
      )[rawAction] ?? rawAction;
    const quantity = Number(value(row, "quantity").replace(/,/g, ""));
    const price = Number(value(row, "price").replace(/,/g, ""));
    const rawDate = value(row, "trade_date");
    const trade_date = normalizeTradeDate(rawDate);
    const ref_id = value(row, "ref_id");
    const rawConfidence = value(row, "confidence_score");
    const confidence = rawConfidence === "" ? 0.95 : Number(rawConfidence);
    const valid =
      !!ticker &&
      ["BUY", "SELL", "DIV"].includes(action) &&
      Number.isFinite(quantity) &&
      quantity > 0 &&
      Number.isFinite(price) &&
      price > 0 &&
      !!trade_date;
    if (!valid) {
      skipped++;
      extracted.push({
        source: row,
        status: "needs_review",
        reason: "Missing or invalid ticker, action, positive quantity/price, or ISO trade date",
      });
      continue;
    }
    const fees = Number(value(row, "fees").replace(/,/g, "")) || 0;
    const wht = Number(value(row, "wht").replace(/,/g, "")) || 0;
    let duplicateQuery = db
      .from("transactions")
      .select("id")
      .eq("org_id", orgId)
      .eq("ticker", ticker)
      .eq("action", action)
      .eq("trade_date", trade_date)
      .eq("quantity", quantity)
      .eq("price", price);
    if (ref_id) {
      duplicateQuery = db
        .from("transactions")
        .select("id")
        .eq("org_id", orgId)
        .eq("ref_id", ref_id);
    }
    const { data: duplicate } = await duplicateQuery.limit(1).maybeSingle();
    if (duplicate) {
      skipped++;
      continue;
    }
    const { data: tx, error } = await db
      .from("transactions")
      .insert({
        org_id: orgId,
        document_id: documentId,
        ticker,
        action,
        quantity,
        price,
        fees,
        wht,
        trade_date,
        ref_id,
        broker: value(row, "broker"),
        exchange: value(row, "exchange") || "PSX",
        confidence_score: Number.isFinite(confidence) ? confidence : 0.5,
        status:
          (Number.isFinite(confidence) ? confidence : 0.5) >= 0.75 ? "posted" : "needs_review",
        source: {
          via: "document_upload",
          agent_run_id: runId,
          document_id: documentId,
          filename,
        } as never,
      } as never)
      .select("id")
      .single();
    if (error) {
      skipped++;
      extracted.push({ source: row, status: "failed", reason: error.message });
      continue;
    }
    inserted++;
    extracted.push({
      transaction_id: tx.id,
      ticker,
      action,
      quantity,
      price,
      trade_date,
      ref_id,
      status: "posted",
    });
  }
  if (documentId) {
    const { error } = await db
      .from("documents")
      .update({
        status: "done",
        extracted_data: {
          filename,
          processed: rows.length,
          inserted,
          skipped,
          rows: extracted,
        } as never,
      })
      .eq("id", documentId)
      .eq("org_id", orgId);
    if (error)
      throw new Error(
        `Ledger rows saved but document status could not be updated: ${error.message}`,
      );
  }
  return { document_id: documentId, filename, processed: rows.length, inserted, skipped };
}

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization,content-type",
      },
    });
  }

  if (!SUPABASE_SERVICE || req.headers.get("authorization") !== `Bearer ${SUPABASE_SERVICE}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  let activeJobId: string | null = null;
  let activeOrgId: string | null = null;
  let activeDocumentId: string | null = null;
  try {
    // Dequeue one pending job
    const { data: job, error: dqErr } = await db.rpc("dequeue_agent_job", {
      p_worker_id: "edge-fn",
    });
    if (dqErr || !job) {
      return new Response(JSON.stringify({ message: "no jobs" }), { status: 200 });
    }

    const orgId = job.org_id as string;
    const jobId = job.id as string;
    activeJobId = jobId;
    const runId = job.run_id as string;
    const trigger = job.trigger_type as string;
    const payload = (job.trigger_payload ?? {}) as Record<string, unknown>;
    activeOrgId = job.org_id as string;
    activeDocumentId = typeof payload["document_id"] === "string" ? payload["document_id"] : null;

    // Explicit uploads must work even when optional autonomous monitoring is off.
    if (!["cron_nightly", "cron_monthly", "upload"].includes(trigger)) {
      const { data: flags } = await db
        .from("org_feature_flags")
        .select("autonomous_agent")
        .eq("org_id", orgId)
        .maybeSingle();

      if (!flags?.autonomous_agent) {
        await db.rpc("complete_agent_job", {
          p_job_id: jobId,
          p_status: "done",
          p_result: { skipped: "autonomous_agent_disabled" },
        });
        return new Response(JSON.stringify({ skipped: true }), { status: 200 });
      }
    }

    let result: Record<string, unknown> = {};

    switch (trigger) {
      case "cron_nightly":
        result = await handleNightlyReconcile(orgId, runId);
        break;
      case "cron_monthly":
        result = await handleMonthlyTaxRun(orgId);
        break;
      case "ingestion":
      case "upload":
      case "sheet_change":
        result = await handleIngestion(orgId, runId, payload);
        break;
      default:
        result = { message: `unhandled trigger: ${trigger}` };
    }

    // Invariant checks
    const failures = await checkInvariants(orgId, runId);
    if (failures.length > 0) {
      await db.rpc("revert_run", { p_run_id: runId });
      await db.rpc("complete_agent_job", {
        p_job_id: jobId,
        p_status: "failed_invariant",
        p_error: failures.join("; "),
        p_result: { failures },
      });
      return new Response(JSON.stringify({ failed_invariant: true, failures }), { status: 200 });
    }

    await db.rpc("complete_agent_job", { p_job_id: jobId, p_status: "done", p_result: result });
    return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    console.error("[agent-runner]", msg);
    if (activeDocumentId && activeOrgId) {
      await db
        .from("documents")
        .update({ status: "failed", extracted_data: { error: msg } as never })
        .eq("id", activeDocumentId)
        .eq("org_id", activeOrgId);
    }
    if (activeJobId) {
      await db.rpc("complete_agent_job", {
        p_job_id: activeJobId,
        p_status: "failed",
        p_error: msg,
        p_result: { error: msg },
      });
    }
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
});
