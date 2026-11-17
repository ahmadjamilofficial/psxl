import { useNavigate } from "@tanstack/react-router";
import { Check, ChevronDown, Loader2, MessageSquare, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { useChatThreads, useDeleteChatThread } from "@/lib/data-hooks";
import { supabase } from "@/lib/supabase";

function formatDate(iso: string) {
  const date = new Date(iso);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function ChatSidebar({ activeId }: { activeId: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: threads = [], isLoading } = useChatThreads(user?.id);
  const deleteThread = useDeleteChatThread();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const active = threads.find((thread) => thread.id === activeId);

  useEffect(() => {
    function closeOnOutside(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutside);
    return () => document.removeEventListener("mousedown", closeOnOutside);
  }, []);

  const filteredThreads = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return threads
      .filter((thread) => !normalized || (thread.title ?? "").toLowerCase().includes(normalized))
      .slice(0, 40);
  }, [query, threads]);

  async function createChat() {
    if (!user || creating) return;
    setCreating(true);
    try {
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (profileError || !profile?.org_id)
        throw new Error(profileError?.message ?? "Workspace is not ready yet");
      const { data, error } = await supabase
        .from("chat_threads")
        .insert({ user_id: user.id, org_id: profile.org_id, title: "New chat" } as never)
        .select("id")
        .single();
      if (error || !data) throw new Error(error?.message ?? "Could not create chat");
      await queryClient.invalidateQueries({ queryKey: ["chat_threads", user.id] });
      setOpen(false);
      setQuery("");
      navigate({ to: "/app/parser/$threadId", params: { threadId: data.id } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create chat");
    } finally {
      setCreating(false);
    }
  }

  async function removeChat(id: string) {
    if (!user) return;
    try {
      await deleteThread.mutateAsync({ threadId: id, userId: user.id });
      toast.success("Conversation deleted");
      setOpen(false);
      if (id === activeId) navigate({ to: "/app/parser" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete chat");
    }
  }

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex min-w-0 max-w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left transition-colors hover:bg-[var(--accent-5)]"
      >
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-lg"
          style={{ background: "var(--accent-8)", color: "var(--color-accent)" }}
        >
          <MessageSquare size={14} strokeWidth={1.8} />
        </span>
        <span className="min-w-0">
          <span
            className="block text-[10px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: "var(--ink-3)" }}
          >
            Conversation
          </span>
          <span className="block max-w-[min(52vw,340px)] truncate text-sm font-semibold">
            {active?.title || "New chat"}
          </span>
        </span>
        <ChevronDown
          size={15}
          className="ml-1 shrink-0"
          style={{ color: "var(--ink-3)", transform: open ? "rotate(180deg)" : "none" }}
        />
      </button>

      {open && (
        <div
          className="absolute left-0 top-[calc(100%+10px)] z-40 w-[min(92vw,360px)] overflow-hidden rounded-2xl bg-surface shadow-[var(--shadow-hover)]"
          style={{ border: "1px solid var(--hairline-strong)" }}
        >
          <div
            className="flex items-center justify-between gap-3 border-b px-3 py-2.5"
            style={{ borderColor: "var(--hairline)" }}
          >
            <div>
              <p className="text-sm font-semibold">Your chats</p>
              <p className="text-[11px]" style={{ color: "var(--ink-3)" }}>
                Switch context without leaving Ask Wab
              </p>
            </div>
            <button
              type="button"
              onClick={() => void createChat()}
              disabled={creating}
              className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              style={{ background: "var(--color-accent)" }}
            >
              {creating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} New
              chat
            </button>
          </div>
          <div className="p-2">
            <label
              className="flex items-center gap-2 rounded-xl px-2.5 py-2"
              style={{ background: "var(--accent-4)" }}
            >
              <Search size={13} style={{ color: "var(--ink-3)" }} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search conversations"
                className="w-full bg-transparent text-xs outline-none"
                autoFocus
              />
            </label>
          </div>
          <div
            className="max-h-72 overflow-y-auto px-2 pb-2"
            role="listbox"
            aria-label="Conversations"
          >
            {isLoading && (
              <p className="px-2 py-4 text-xs" style={{ color: "var(--ink-3)" }}>
                Loading conversations…
              </p>
            )}
            {!isLoading && filteredThreads.length === 0 && (
              <p className="px-2 py-4 text-xs" style={{ color: "var(--ink-3)" }}>
                No matching conversations.
              </p>
            )}
            {filteredThreads.map((thread) => (
              <div
                key={thread.id}
                className="group flex items-center gap-2 rounded-xl px-2 py-2 transition-colors hover:bg-[var(--accent-5)]"
                role="option"
                aria-selected={thread.id === activeId}
              >
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    navigate({ to: "/app/parser/$threadId", params: { threadId: thread.id } });
                  }}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span
                    className="flex size-6 shrink-0 items-center justify-center rounded-md"
                    style={{
                      background: thread.id === activeId ? "var(--accent-10)" : "var(--accent-4)",
                      color: thread.id === activeId ? "var(--color-accent)" : "var(--ink-3)",
                    }}
                  >
                    {thread.id === activeId ? <Check size={12} /> : <MessageSquare size={12} />}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">
                    {thread.title || "New chat"}
                  </span>
                  <span className="shrink-0 text-[10px]" style={{ color: "var(--ink-3)" }}>
                    {formatDate(thread.updated_at ?? thread.created_at)}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void removeChat(thread.id)}
                  aria-label={`Delete ${thread.title || "chat"}`}
                  className="hidden size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-destructive group-hover:flex"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
