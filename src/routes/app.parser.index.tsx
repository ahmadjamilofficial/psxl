import { brandText } from "@/lib/brand";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { withTimeout } from "@/lib/utils";

export const Route = createFileRoute("/app/parser/")({
  component: ParserIndex,
});

function ParserIndex() {
  const { user, session, loading, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const started = useRef(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (loading || !user || !session?.access_token || started.current) return;
    started.current = true;
    setFailure(null);
    void (async () => {
      try {
        // Deliberately do not reuse sessionStorage or the last thread here.
        // Entering Ask {{brand}} is a clean working session; explicit thread URLs
        // remain the way to reopen a saved conversation.
        let { data: profile, error: profileError } = await withTimeout(
          supabase.from("profiles").select("org_id").eq("user_id", user.id).maybeSingle(),
          15000,
          "Profile lookup",
        );
        if (profileError) throw new Error(profileError.message);
        if (!profile?.org_id) {
          await refreshProfile();
          const retry = await withTimeout(
            supabase.from("profiles").select("org_id").eq("user_id", user.id).maybeSingle(),
            15000,
            "Profile retry",
          );
          profile = retry.data;
          profileError = retry.error;
        }
        if (profileError || !profile?.org_id) {
          throw new Error(
            profileError?.message ??
              "Your workspace is still being prepared. Try again in a moment.",
          );
        }
        const { data: created, error } = await withTimeout(
          supabase
            .from("chat_threads")
            .insert({ user_id: user.id, org_id: profile.org_id, title: "New chat" } as never)
            .select("id")
            .single(),
          15000,
          "New chat creation",
        );
        if (error || !created)
          throw new Error(error?.message ?? "Could not open a new AI workspace.");
        navigate({ to: "/app/parser/$threadId", params: { threadId: created.id }, replace: true });
      } catch (cause) {
        console.error(brandText("[{{brand}}][ParserIndex] failed to create fresh chat"), cause);
        setFailure(cause instanceof Error ? cause.message : "Could not open the AI workspace.");
        started.current = false;
      }
    })();
  }, [loading, user, session?.access_token, navigate, refreshProfile]);

  if (failure) {
    return (
      <div className="flex h-[70vh] flex-col items-center justify-center gap-4 text-center">
        <p className="max-w-md text-sm" style={{ color: "var(--ink-2)" }}>
          {failure}
        </p>
        <button
          type="button"
          onClick={() => setFailure(null)}
          className="rounded-full px-4 py-2 text-xs font-semibold text-white"
          style={{ background: "var(--color-accent)" }}
        >
          Try again
        </button>
      </div>
    );
  }
  return (
    <div className="flex h-[70vh] items-center justify-center">
      <Shimmer>{brandText("Starting a fresh Ask {{brand}} conversation…")}</Shimmer>
    </div>
  );
}
