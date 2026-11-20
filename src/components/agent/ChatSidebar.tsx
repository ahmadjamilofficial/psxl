import { useNavigate } from "@tanstack/react-router";
import { Check, Loader2, MessageSquare, Plus, Search, Trash2 } from "lucide-react";
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
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const active = threads.find((thread) => thread.id === activeId);

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
      if (id === activeId) navigate({ to: "/app/parser" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete chat");
    }
  }

  return (
    <aside
      className="flex h-full min-h-0 w-[68px] shrink-0 flex-col border-r sm:w-[248px]"
      style={{ background: "var(--color-login-bg)", borderColor: "var(--hairline)" }}
      aria-label="Chat history"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-2 py-3 sm:px-3" style={{borderColor:"var(--hairline)"}}>
        <div className="hidden min-w-0 sm:block">
          <p className="text-xs font-semibold">Chat history</p>
          <p className="mt-0.5 text-[10px]" style={{color:"var(--ink-3)"}}>Your conversations</p>
        </div>
        <button
          type="button"
          onClick={() => void createChat()}
          disabled={creating}
          aria-label="New chat"
          title="New chat"
          className="mx-auto flex size-9 shrink-0 items-center justify-center rounded-xl text-white transition-opacity hover:opacity-90 disabled:opacity-50 sm:mx-0 sm:w-auto sm:px-3"
          style={{background:"var(--color-accent)"}}
        >
          {creating ? <Loader2 size={14} className="animate-spin"/> : <Plus size={15}/>}
          <span className="ml-1.5 hidden text-xs font-semibold sm:inline">New chat</span>
        </button>
      </div>

      <div className="hidden shrink-0 p-2 sm:block">
        <label className="flex items-center gap-2 rounded-xl px-2.5 py-2" style={{background:"var(--accent-4)"}}>
          <Search size={13} className="shrink-0" style={{color:"var(--ink-3)"}}/>
          <input
            value={query}
            onChange={(event)=>setQuery(event.target.value)}
            placeholder="Search chats"
            aria-label="Search conversations"
            className="w-full min-w-0 bg-transparent text-xs outline-none"
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-3 sm:px-2" role="listbox" aria-label="Conversations">
        {isLoading && <p className="px-2 py-4 text-[10px] sm:text-xs" style={{color:"var(--ink-3)"}}>Loading…</p>}
        {!isLoading && filteredThreads.length===0 && (
          <p className="px-1 py-4 text-center text-[10px] sm:px-2 sm:text-xs" style={{color:"var(--ink-3)"}}>{query ? "No matches" : "No chats yet"}</p>
        )}
        {filteredThreads.map((thread)=>(
          <div
            key={thread.id}
            className="group mb-1 flex items-center gap-1 rounded-xl transition-colors hover:bg-[var(--accent-5)]"
            style={thread.id===activeId ? {background:"var(--accent-5)"} : undefined}
            role="option"
            aria-selected={thread.id===activeId}
          >
            <button
              type="button"
              onClick={()=>navigate({to:"/app/parser/$threadId",params:{threadId:thread.id}})}
              title={thread.title || "New chat"}
              className="flex min-w-0 flex-1 items-center justify-center gap-2 px-1.5 py-2.5 text-left sm:justify-start sm:px-2"
            >
              <span
                className="flex size-7 shrink-0 items-center justify-center rounded-lg"
                style={{
                  background:thread.id===activeId ? "var(--accent-10)" : "var(--accent-4)",
                  color:thread.id===activeId ? "var(--color-accent)" : "var(--ink-3)",
                }}
              >
                {thread.id===activeId ? <Check size={13}/> : <MessageSquare size={13}/>}
              </span>
              <span className="hidden min-w-0 flex-1 sm:block">
                <span className="block truncate text-xs font-medium" style={{color:"var(--color-text)"}}>{thread.title || "New chat"}</span>
                <span className="mt-0.5 block text-[10px]" style={{color:"var(--ink-3)"}}>{formatDate(thread.updated_at ?? thread.created_at)}</span>
              </span>
            </button>
            <button
              type="button"
              onClick={()=>void removeChat(thread.id)}
              aria-label={`Delete ${thread.title || "chat"}`}
              title="Delete chat"
              className="hidden size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-[var(--accent-6)] hover:text-destructive sm:group-hover:flex"
            >
              <Trash2 size={12}/>
            </button>
          </div>
        ))}
      </div>
      <div className="hidden shrink-0 border-t px-3 py-2 sm:block" style={{borderColor:"var(--hairline)"}}>
        <p className="text-[10px]" style={{color:"var(--ink-3)"}}>{threads.length} conversation{threads.length===1 ? "" : "s"}</p>
      </div>
    </aside>
  );
}
