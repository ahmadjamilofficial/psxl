import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { FileUp, RefreshCw, CheckCircle2, AlertTriangle, FileText, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { useTransactions, useReconciliationFlags, useUpdateTransaction, useDocuments } from "@/lib/data-hooks";

export const Route = createFileRoute("/app/broker-desk")({ component: BrokerDesk });

function BrokerDesk() {
  const { profile, session } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: documents = [], isLoading: loadingDocs, refetch: loadDocuments } = useDocuments(profile?.org_id);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { data: transactions = [] } = useTransactions(profile?.org_id);
  const { data: flags = [] } = useReconciliationFlags(profile?.org_id);
  const updateTransaction = useUpdateTransaction();

  const reviewQueue = useMemo(() => transactions.filter((tx) => tx.status === "needs_review"), [transactions]);
  const posted = transactions.filter((tx) => tx.status === "posted").length;

  async function uploadStatements(files: FileList | null) {
    if (!files?.length || !session?.access_token) return;
    setUploading(true);
    try {
      const form = new FormData();
      Array.from(files).forEach((file) => form.append("files", file));
      const response = await fetch("/api/documents/upload", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}` }, body: form });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.message ?? (typeof payload === "string" ? payload : "Statement upload failed."));
      toast.success(`${payload.uploaded?.length ?? files.length} statement(s) queued for extraction.`);
      if (fileRef.current) fileRef.current.value = "";
      await loadDocuments();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Statement upload failed.");
    } finally { setUploading(false); }
  }

  async function approveTransaction(id: string) {
    if (!profile?.org_id) return;
    setBusyId(id);
    try {
      await updateTransaction.mutateAsync({ id, orgId: profile.org_id, values: { status: "posted" } });
      toast.success("Transaction approved and posted to the ledger.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not approve transaction.");
    } finally { setBusyId(null); }
  }

  const badge = (status: string) => status === "done" || status === "posted"
    ? "bg-emerald-500/10 text-emerald-600"
    : status === "failed" ? "bg-red-500/10 text-red-600" : "bg-amber-500/10 text-amber-600";

  return <div className="space-y-6 p-3 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-semibold uppercase tracking-[.16em]" style={{color:"var(--ink-3)"}}>Broker operations</p><h1 className="mt-1 text-2xl font-semibold" style={{fontFamily:"var(--font-heading)"}}>Broker Desk</h1><p className="mt-1 text-sm" style={{color:"var(--ink-2)"}}>Statements, exception review and controlled ledger posting.</p></div>
      <button onClick={() => void loadDocuments()} disabled={loadingDocs} className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm" style={{borderColor:"var(--hairline)"}}><RefreshCw size={15} className={loadingDocs?"animate-spin":""}/> Refresh</button>
    </header>

    <section className="rounded-2xl border p-5 sm:p-6" style={{borderColor:"var(--hairline)",background:"var(--color-sheet)"}}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3"><span className="rounded-xl p-3" style={{background:"var(--accent-8)",color:"var(--color-accent)"}}><FileUp size={20}/></span><div><h2 className="font-semibold">Statement ingestion</h2><p className="mt-1 max-w-xl text-sm" style={{color:"var(--ink-2)"}}>Upload broker contract notes or statements. PSXL stores the source document and queues extraction for review; uploaded rows are not automatically treated as verified trades.</p><p className="mt-2 text-xs" style={{color:"var(--ink-3)"}}>PDF, CSV, XLSX, XLS, TSV, TXT and common image formats · existing plan upload limits apply</p></div></div>
        <input ref={fileRef} type="file" multiple accept=".pdf,.csv,.xlsx,.xls,.tsv,.txt,.png,.jpg,.jpeg,.webp" className="hidden" onChange={(e)=>void uploadStatements(e.target.files)}/>
        <button onClick={()=>fileRef.current?.click()} disabled={uploading} className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60" style={{background:"var(--color-accent)"}}>{uploading?<RefreshCw size={16} className="animate-spin"/>:<FileUp size={16}/>} {uploading?"Uploading…":"Upload statements"}</button>
      </div>
    </section>

    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[["Posted transactions",posted],["Needs review",reviewQueue.length],["Open exceptions",flags.length],["Recent documents",documents.length]].map(([label,value])=><div key={label} className="rounded-xl border p-4" style={{borderColor:"var(--hairline)",background:"var(--color-sheet)"}}><p className="text-2xl font-semibold tabular-nums">{value}</p><p className="mt-1 text-xs" style={{color:"var(--ink-2)"}}>{label}</p></div>)}
    </div>

    <section className="overflow-hidden rounded-2xl border" style={{borderColor:"var(--hairline)",background:"var(--color-sheet)"}}>
      <div className="flex items-center justify-between border-b px-5 py-4" style={{borderColor:"var(--hairline)"}}><div><h2 className="font-semibold">Statement processing queue</h2><p className="text-xs" style={{color:"var(--ink-3)"}}>Latest 30 uploaded documents</p></div><FileText size={18} style={{color:"var(--ink-3)"}}/></div>
      {documents.length===0?<p className="p-6 text-sm" style={{color:"var(--ink-3)"}}>{loadingDocs?"Loading documents…":"No statements uploaded yet."}</p>:<div className="divide-y" style={{borderColor:"var(--hairline)"}}>{documents.map(doc=><div key={doc.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"><div className="flex min-w-0 items-center gap-3"><FileText size={17} style={{color:"var(--ink-3)"}}/><div className="min-w-0"><p className="truncate text-sm font-medium">{doc.storage_path.split("/").pop()?.replace(/^[0-9a-f-]{20,}-/i,"") ?? "Statement"}</p><p className="text-xs" style={{color:"var(--ink-3)"}}>{new Date(doc.created_at).toLocaleString()} · {doc.doc_type.replaceAll("_"," ")}</p></div></div><div className="flex items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${badge(doc.status)}`}>{doc.status}</span>{doc.confidence_score!=null&&<span className="text-xs tabular-nums" style={{color:"var(--ink-3)"}}>{Math.round(doc.confidence_score*100)}% confidence</span>}</div></div>)}</div>}
    </section>

    <section className="overflow-hidden rounded-2xl border" style={{borderColor:"var(--hairline)",background:"var(--color-sheet)"}}>
      <div className="border-b px-5 py-4" style={{borderColor:"var(--hairline)"}}><h2 className="font-semibold">Human review inbox</h2><p className="text-xs" style={{color:"var(--ink-3)"}}>Approve extracted transactions only after checking the source statement.</p></div>
      {reviewQueue.length===0?<div className="flex items-center gap-2 p-6 text-sm" style={{color:"var(--ink-3)"}}><CheckCircle2 size={17}/> No transactions are waiting for review.</div>:<div className="divide-y" style={{borderColor:"var(--hairline)"}}>{reviewQueue.slice(0,50).map(tx=><div key={tx.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"><div><p className="text-sm font-semibold">{tx.action} · {tx.ticker} <span className="font-normal" style={{color:"var(--ink-3)"}}>· {tx.exchange}</span></p><p className="mt-1 text-xs" style={{color:"var(--ink-2)"}}>{tx.quantity.toLocaleString()} shares × {tx.price.toLocaleString()} · {tx.trade_date} · {tx.broker || "Unknown broker"}</p><p className="mt-1 text-xs" style={{color:"var(--ink-3)"}}>Reference: {tx.ref_id || "missing"} · extraction confidence {Math.round(tx.confidence_score*100)}%</p></div><button onClick={()=>void approveTransaction(tx.id)} disabled={busyId===tx.id} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50" style={{borderColor:"var(--hairline)"}}>{busyId===tx.id?<RefreshCw size={14} className="animate-spin"/>:<CheckCircle2 size={14}/>} Approve & post</button></div>)}</div>}
    </section>

    <section className="rounded-2xl border p-5" style={{borderColor:"var(--hairline)"}}><div className="flex items-center gap-2"><AlertTriangle size={17} style={{color:"var(--warn)"}}/><h2 className="font-semibold">Open reconciliation exceptions</h2></div><p className="mt-1 text-sm" style={{color:"var(--ink-2)"}}>{flags.length} open exception(s) are available in the reconciliation workspace.</p><a href="/app/reconciliation" className="mt-3 inline-flex items-center gap-2 text-sm font-semibold" style={{color:"var(--color-accent)"}}>Review exceptions <ArrowRight size={15}/></a></section>
  </div>;
}
