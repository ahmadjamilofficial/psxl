import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Activity, Plus, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { useTransactions } from "@/lib/data-hooks";

export const Route = createFileRoute("/app/market-intelligence")({ component: MarketIntelligence });
type Quote = { ticker:string; exchange:string; price:number; change:number; changePercent:number; currency:string; lastUpdated:string };

function MarketIntelligence() {
  const { profile } = useAuth();
  const { data: transactions = [] } = useTransactions(profile?.org_id);
  const ledgerSymbols = useMemo(()=>[...new Set(transactions.filter(t=>t.status==="posted" && t.exchange==="PSX").map(t=>t.ticker.toUpperCase()))].sort(),[transactions]);
  const [customSymbols,setCustomSymbols] = useState<string[]>([]);
  const [draft,setDraft] = useState("");
  const [quotes,setQuotes] = useState<Quote[]>([]);
  const [requestedAt,setRequestedAt] = useState<string|null>(null);
  const [loading,setLoading] = useState(false);
  const symbols = [...new Set([...ledgerSymbols,...customSymbols])].slice(0,100);

  async function refreshQuotes() {
    if(!symbols.length){toast.info("Add a PSX ticker or post a PSX trade first.");return;}
    setLoading(true);
    try {
      const response=await fetch("/api/market-data",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({tickers:symbols.map(ticker=>({ticker,exchange:"PSX"}))})});
      const body=await response.json();
      if(!response.ok) throw new Error(body.error??"Market quote request failed.");
      setQuotes((body.prices??[]) as Quote[]);
      setRequestedAt(new Date().toISOString());
      const returned=(body.prices??[]).length;
      if(returned===0) toast.warning("No quotes were returned. The provider may not cover these PSX symbols.");
      else if(returned<symbols.length) toast.warning("Received "+returned+" of "+symbols.length+" requested quotes.");
      else toast.success("Updated "+returned+" market quotes.");
    } catch(error) {
      toast.error(error instanceof Error?error.message:"Market data is temporarily unavailable.");
    } finally {setLoading(false);}
  }

  function addSymbol(event:React.FormEvent) {
    event.preventDefault();
    const value=draft.trim().toUpperCase();
    if(!/^[A-Z0-9][A-Z0-9.&_-]{0,19}$/.test(value)){toast.error("Enter a valid ticker symbol, not a company name.");return;}
    if(symbols.includes(value)){toast.info("That ticker is already on your watchlist.");return;}
    if(symbols.length>=100){toast.error("Watchlist limit is 100 symbols.");return;}
    setCustomSymbols(current=>[...current,value]);
    setDraft("");
  }

  const quoteMap=new Map(quotes.map(q=>[q.ticker.toUpperCase(),q]));
  return <div className="space-y-6 p-3 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[.16em]" style={{color:"var(--ink-3)"}}>Pakistan Stock Exchange</p><h1 className="mt-1 text-2xl font-semibold" style={{fontFamily:"var(--font-heading)"}}>Market Intelligence</h1><p className="mt-1 text-sm" style={{color:"var(--ink-2)"}}>A source-labelled PSX watchlist connected to your posted ledger holdings.</p></div><button onClick={()=>void refreshQuotes()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60" style={{background:"var(--color-accent)"}}>{loading?<RefreshCw size={15} className="animate-spin"/>:<Activity size={15}/>} {loading?"Refreshing…":"Refresh quotes"}</button></header>
    <section className="rounded-2xl border p-5" style={{borderColor:"var(--hairline)",background:"var(--color-sheet)"}}>
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">PSX watchlist</h2><p className="text-xs" style={{color:"var(--ink-3)"}}>Ledger symbols are included automatically. Add other symbols to track.</p></div><span className="text-xs tabular-nums" style={{color:"var(--ink-3)"}}>{symbols.length}/100 symbols</span></div>
      <form onSubmit={addSymbol} className="mt-4 flex flex-wrap gap-2"><input value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Ticker, e.g. OGDC" aria-label="PSX ticker symbol" className="min-w-0 flex-1 rounded-xl border bg-transparent px-3 py-2.5 text-sm outline-none" style={{borderColor:"var(--hairline)"}}/><button type="submit" className="inline-flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold" style={{borderColor:"var(--hairline)"}}><Plus size={15}/> Add ticker</button></form>
      <div className="mt-3 flex flex-wrap gap-2">{symbols.map(symbol=><span key={symbol} className="rounded-full px-3 py-1.5 text-xs font-semibold" style={{background:"var(--accent-8)",color:"var(--color-accent)"}}>{symbol}</span>)}</div>
    </section>
    <section className="overflow-hidden rounded-2xl border" style={{borderColor:"var(--hairline)",background:"var(--color-sheet)"}}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-4" style={{borderColor:"var(--hairline)"}}><div><h2 className="font-semibold">Latest available quotes</h2><p className="text-xs" style={{color:"var(--ink-3)"}}>{requestedAt?"Requested "+new Date(requestedAt).toLocaleString():"No quote request in this session yet"}</p></div><span className="text-xs" style={{color:"var(--ink-3)"}}>Provider: Yahoo Finance</span></div>
      {quotes.length===0?<div className="p-8 text-center"><Activity size={25} className="mx-auto" style={{color:"var(--ink-3)"}}/><p className="mt-3 text-sm font-medium">No market quotes loaded</p><p className="mt-1 text-xs" style={{color:"var(--ink-3)"}}>Refresh quotes to request provider data for your watchlist.</p></div>:<div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead><tr className="text-xs" style={{color:"var(--ink-3)"}}>{["Ticker","Exchange","Last price","Change","Provider timestamp"].map(x=><th key={x} className="px-5 py-3 font-medium">{x}</th>)}</tr></thead><tbody>{symbols.map(symbol=>{const q=quoteMap.get(symbol);return <tr key={symbol} className="border-t" style={{borderColor:"var(--hairline)"}}><td className="px-5 py-3 font-semibold">{symbol}</td><td className="px-5 py-3">PSX</td><td className="px-5 py-3 tabular-nums">{q?q.currency+" "+q.price.toLocaleString("en-PK",{maximumFractionDigits:4}):"—"}</td><td className="px-5 py-3">{q?<span className="inline-flex items-center gap-1 text-xs font-semibold" style={{color:q.change>=0?"var(--ok)":"var(--bad)"}}>{q.change>=0?<TrendingUp size={13}/>:<TrendingDown size={13}/>} {q.change>=0?"+":""}{q.change.toFixed(4)} ({q.changePercent.toFixed(2)}%)</span>:"Unavailable"}</td><td className="px-5 py-3 text-xs" style={{color:"var(--ink-3)"}}>{q?new Date(q.lastUpdated).toLocaleString():"Not returned by provider"}</td></tr>})}</tbody></table></div>}
    </section>
    <div className="rounded-2xl border p-5" style={{borderColor:"var(--hairline)"}}><h2 className="font-semibold">Data quality and coverage</h2><ul className="mt-2 list-disc space-y-1 pl-5 text-sm" style={{color:"var(--ink-2)"}}><li>Quotes are retrieved on demand from Yahoo Finance; availability and latency depend on that provider.</li><li>Not every PSX-listed instrument is guaranteed to be covered or mapped correctly.</li><li>This is not an official PSX feed. Do not treat delayed or unavailable quotes as executable prices.</li><li>PSXL does not execute trades or provide personalised buy/sell recommendations.</li></ul></div>
  </div>;
}
