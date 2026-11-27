import { createFileRoute } from "@tanstack/react-router";
import { streamText } from "ai";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseServerConfig } from "@/lib/env.server";
import { planOf } from "@/lib/plans";

export const Route = createFileRoute("/api/intelligence")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authorization = request.headers.get("authorization") ?? "";
        if (!authorization.startsWith("Bearer ")) {
          return Response.json({ code: "unauthorized", error: "Sign in to use AI." }, { status: 401 });
        }
        const config = supabaseServerConfig();
        if (!config) {
          return Response.json({ code: "database_unavailable", error: "Database configuration is missing." }, { status: 503 });
        }
        const supabase = createClient<Database>(config.url, config.key, {
          global: { headers: { Authorization: authorization } },
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (authError || !authData.user) {
          return Response.json({ code: "unauthorized", error: "Your session has expired. Sign in again." }, { status: 401 });
        }
        const body = (await request.json().catch(() => ({}))) as { systemPrompt?: string; userPrompt?: string };
        if (!body.systemPrompt || !body.userPrompt) {
          return Response.json({ error: "systemPrompt and userPrompt are required" }, { status: 400 });
        }
        const { data: profile, error: profileError } = await supabase
          .from("profiles").select("org_id").eq("user_id", authData.user.id).maybeSingle();
        if (profileError || !profile?.org_id) {
          return Response.json({ code: "workspace_unavailable", error: "Could not resolve your workspace." }, { status: 403 });
        }
        const { data: subscription, error: subscriptionError } = await supabase
          .from("subscriptions")
          .select("plan,status,trial_end_at,current_period_end,cancel_at_period_end")
          .eq("org_id", profile.org_id).maybeSingle();
        if (subscriptionError) {
          return Response.json({ code: "quota_check_unavailable", error: "Could not verify your AI allowance. Please retry." }, { status: 503 });
        }
        const active = subscription && ["active", "trialing"].includes(subscription.status);
        const trialValid = subscription?.status !== "trialing" ||
          (!!subscription.trial_end_at && new Date(subscription.trial_end_at).getTime() > Date.now());
        const periodValid = !subscription?.current_period_end ||
          new Date(subscription.current_period_end).getTime() > Date.now();
        const plan = active && !subscription?.cancel_at_period_end && trialValid && periodValid
          ? subscription.plan : "free";
        const limits = planOf(plan);
        const usageSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const pendingSince = new Date(Date.now() - 15 * 60 * 1000).toISOString();
        const { data: usageRows, error: usageReadError } = await supabase
          .from("ai_usage").select("credits_used").eq("user_id", authData.user.id).eq("plan", plan)
          .or(`status.eq.ok,and(status.eq.pending,created_at.gte.${pendingSince})`)
          .gte("created_at", usageSince);
        if (usageReadError) {
          return Response.json({ code: "quota_check_unavailable", error: "Could not verify your AI allowance. Please retry." }, { status: 503 });
        }
        const creditsUsed = (usageRows ?? []).reduce((sum, row) => sum + Number(row.credits_used ?? 0), 0);
        if (creditsUsed >= limits.monthlyAiCredits) {
          return Response.json({
            code: "quota_exceeded", plan, monthly_limit: limits.monthlyAiCredits, credits_used: creditsUsed,
            message: `You've used all ${limits.monthlyAiCredits} AI credits in your rolling 30-day allowance. Upgrade your plan for more AI capacity.`,
          }, { status: 429, headers: { "Retry-After": "3600" } });
        }
        const usageId = crypto.randomUUID();
        const { error: usageWriteError } = await supabase.from("ai_usage").insert({
          id: usageId, user_id: authData.user.id, org_id: profile.org_id, plan,
          model: "intelligence", inference_requests: 1, credits_used: 1, status: "pending",
        } as never);
        if (usageWriteError) {
          return Response.json({ code: "quota_accounting_unavailable", error: "AI usage could not be recorded, so this request was not started." }, { status: 503 });
        }
        try {
          const { resolveAgentModel, selectWorkingModel } = await import("@/lib/audit-agent.server");
          const resolved = await resolveAgentModel();
          if (!resolved) {
            await supabase.from("ai_usage").update({ status: "failed", credits_used: 0 }).eq("id", usageId);
            return Response.json({ error: "AI not configured" }, { status: 503 });
          }
          const selected = await selectWorkingModel(resolved);
          if (!selected.model) {
            await supabase.from("ai_usage").update({ status: "failed", credits_used: 0 }).eq("id", usageId);
            return Response.json({ error: "No AI provider available" }, { status: 503 });
          }
          const result = streamText({
            model: selected.model.model, providerOptions: selected.model.providerOptions as never,
            system: body.systemPrompt, prompt: body.userPrompt.slice(0, 60000),
            maxRetries: 2, abortSignal: request.signal,
          });
          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            async start(controller) {
              let succeeded = false;
              try {
                for await (const chunk of result.textStream) controller.enqueue(encoder.encode(chunk));
                succeeded = true;
              } catch (error) {
                console.error("[PSXL Intelligence] Stream failed:", error);
              } finally {
                await supabase.from("ai_usage").update({
                  status: succeeded ? "ok" : "failed", credits_used: succeeded ? 1 : 0,
                }).eq("id", usageId).eq("user_id", authData.user.id);
                controller.close();
              }
            },
          });
          return new Response(stream, { headers: {
            "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
          }});
        } catch (error) {
          await supabase.from("ai_usage").update({ status: "failed", credits_used: 0 }).eq("id", usageId);
          console.error("[PSXL Intelligence] Request failed:", error);
          return Response.json({ code: "provider_error", error: "The AI service could not complete this request." }, { status: 503 });
        }
      },
    },
  },
});
