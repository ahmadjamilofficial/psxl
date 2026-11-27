import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useMemo } from "react";
import { ArrowUpRight, BriefcaseBusiness, Calculator, ShieldCheck, Wallet } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useTransactions, useMarketQuotes } from "@/lib/data-hooks";
import { computeTax } from "@/lib/tax";
import { useLedgerContext } from "@/lib/use-ledger-context";
import { currencyForExchange } from "@/lib/market-currency";

export const Route = createFileRoute("/app/investor-intelligence")({ beforeLoad: () => { throw redirect({ to: "/app/overview" }); }, component: InvestorIntelligence });

function InvestorIntelligence() {
  const { profile } = useAuth();
  const { data: transactions = [], isLoading } = useTransactions(profile?.org_id);
  const { jurisdiction, taxYear } = useLedgerContext();
  const posted = useMemo(()=>transactions.filter(tx=>tx.status==="posted"),[transactions]);
  const currencies = [...new Set(posted.map(tx=>tx.currency ?? currencyForExchange(tx.exchange)))];
  const currency = currencies.length===1 ? currencies[0]! : currencies.length>1 ? "Mixed currencies" : "—";

  const positions = useMemo(()=>{
    const map = new Map<string,{ticker:string;exchange:string;currency:string;quantity:number;cost:number}>();
    for(const tx of [...posted].sort((a,b)=>a.trade_date.localeCompare(b.trade_date))){
      const code=tx.currency ?? currencyForExchange(tx.exchange);
      const key=tx.exchange+":"+tx.ticker+":"+code;
      const p=map.get(key) ?? {ticker:tx.ticker,exchange:tx.exchange,currency:code,quantity:0,cost:0};
      if(tx.action==="BUY"){p.cost += tx.quantity*tx.price+tx.fees;p.quantity += tx.quantity;}
      else if(tx.action==="SELL" && p.quantity>0){const avg=p.cost/p.quantity;const sold=Math.min(p.quantity,tx.quantity);p.cost-=avg*sold;p.quantity-=sold;}
      map.set(key,p);
    }
    return [...map.values()].filter(p=>p.quantity>0.00000001).map(p=>({...p,averageCost:p.cost/p.quantity})).sort((a,b)=>b.cost-a.cost);
  },[posted]);

  const { quotes: marketQuotes, isLoading: quotesLoading } = useMarketQuotes(
    profile?.org_id,
    positions.map((position) => ({ ticker: position.ticker, exchange: position.exchange })),
  );
  const quoteMap = new Map(marketQuotes.map((quote) => [quote.exchange + ":" + quote.ticker, quote]));

  const tax = computeTax(posted,{jurisdiction,filerStatus:"Filer",taxYear});
  const totalCost = positions.reduce((sum,p)=>sum+p.cost,0);
  const fmt=(n:number)=>n.toLocaleString("en-PK",{maximumFractionDigits:2});
  return <div className="space-y-6 p-3 sm:p-6">
    <header><p className="text-xs font-semibold uppercase tracking-[.16em]" style={{color:"var(--ink-3)"}}>Investor workspace</p><h1 className="mt-1 text-2xl font-semibold" style={{fontFamily:"var(--font-heading)"}}>Investor Intelligence</h1><p className="mt-1 text-sm" style={{color:"var(--ink-2)"}}>A traceable view of your posted positions, realised results and tax workpapers.</p></header>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[
        {label:"Open positions",value:String(positions.length),sub:"Across posted ledger trades",icon:BriefcaseBusiness},
        {label:"Ledger cost basis",value:currency==="Mixed currencies"?"Mixed":currency==="—"?"—":currency+" "+fmt(totalCost),sub:"Not a live market valuation",icon:Wallet},
        {label:"Realised gain / loss",value:currency==="Mixed currencies"?"Review currencies":currency==="—"?"—":currency+" "+fmt(tax.totalGain),sub:"Computed from posted trades",icon:ArrowUpRight},
        {label:"Indicative tax estimate",value:currency==="Mixed currencies"?"Review currencies":currency==="—"?"—":currency+" "+fmt(tax.estimatedTaxDue),sub:`Tax year ${taxYear} · verify applicable rules`,icon:Calculator},
      ].map(({label,value,sub,icon:Icon})=><div key={label} className="rounded-2xl border p-5" style={{borderColor:"var(--hairline)",background:"var(--color-sheet)"}}><Icon size={18} style={{color:"var(--color-accent)"}}/><p className="mt-3 text-xs" style={{color:"var(--ink-2)"}}>{label}</p><p className="mt-1 break-words text-xl font-semibold tabular-nums">{value}</p><p className="mt-1 text-xs" style={{color:"var(--ink-3)"}}>{sub}</p></div>)}
    </div>
    <section className="overflow-hidden rounded-2xl border" style={{borderColor:"var(--hairline)",background:"var(--color-sheet)"}}>
      <div className="border-b px-5 py-4" style={{borderColor:"var(--hairline)"}}><h2 className="font-semibold">Open positions</h2><p className="text-xs" style={{color:"var(--ink-3)"}}>Average-cost inventory view · quantities replayed from posted trades</p></div>
      {isLoading?<p className="p-5 text-sm" style={{color:"var(--ink-3)"}}>Loading ledger…</p>:positions.length===0?<p className="p-5 text-sm" style={{color:"var(--ink-3)"}}>No open positions yet. Post verified trades to build your portfolio.</p>:<div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead><tr className="text-xs" style={{color:"var(--ink-3)"}}>{["Instrument","Exchange","Quantity","Average cost","Cost basis","Latest quote","Market value","Unrealised P/L"].map(x=><th key={x} className="px-5 py-3 font-medium">{x}</th>)}</tr></thead><tbody>{positions.map(p=>{const quote=quoteMap.get(p.exchange+":"+p.ticker);const marketValue=quote && quote.currency===p.currency?quote.price*p.quantity:null;const unrealised=marketValue==null?null:marketValue-p.cost;return <tr key={p.exchange+":"+p.ticker+":"+p.currency} className="border-t" style={{borderColor:"var(--hairline)"}}><td className="px-5 py-3 font-semibold">{p.ticker}</td><td className="px-5 py-3">{p.exchange}</td><td className="px-5 py-3 tabular-nums">{fmt(p.quantity)}</td><td className="px-5 py-3 tabular-nums">{p.currency} {fmt(p.averageCost)}</td><td className="px-5 py-3 tabular-nums">{p.currency} {fmt(p.cost)}</td><td className="px-5 py-3 tabular-nums">{quote?quote.currency+" "+fmt(quote.price):quotesLoading?"Loading…":"Unavailable"}</td><td className="px-5 py-3 tabular-nums">{marketValue==null?"—":p.currency+" "+fmt(marketValue)}</td><td className="px-5 py-3 tabular-nums" style={{color:unrealised==null?"var(--ink-3)":unrealised>=0?"var(--ok)":"var(--bad)"}}>{unrealised==null?"—":(unrealised>=0?"+":"")+p.currency+" "+fmt(unrealised)}</td></tr>})}</tbody></table></div>}
    </section>
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-2xl border p-5" style={{borderColor:"var(--hairline)"}}><div className="flex items-center gap-2"><ShieldCheck size={18} style={{color:"var(--ok)"}}/><h2 className="font-semibold">Traceable calculations</h2></div><p className="mt-2 text-sm" style={{color:"var(--ink-2)"}}>Only posted transactions enter these summaries. AI does not calculate holdings or tax amounts. Unreviewed records stay out of the figures.</p><Link to="/app/tax" className="mt-3 inline-flex items-center gap-2 text-sm font-semibold" style={{color:"var(--color-accent)"}}>Open tax workpapers <ArrowUpRight size={15}/></Link></div>
      <div className="rounded-2xl border p-5" style={{borderColor:"var(--hairline)"}}><div className="flex items-center gap-2"><Wallet size={18} style={{color:"var(--color-accent)"}}/><h2 className="font-semibold">Market valuation</h2></div><p className="mt-2 text-sm" style={{color:"var(--ink-2)"}}>Cost basis is not current market value. Open the market workspace to request provider quotes, where supported, and check their timestamps.</p><Link to="/app/market-intelligence" className="mt-3 inline-flex items-center gap-2 text-sm font-semibold" style={{color:"var(--color-accent)"}}>Open market intelligence <ArrowUpRight size={15}/></Link></div>
    </div>
    <p className="text-xs leading-relaxed" style={{color:"var(--ink-3)"}}>Market values appear only when a provider quote is available in the same currency as the ledger position; otherwise they remain blank. Quotes may be delayed or unavailable. Tax figures are indicative workpapers, not tax or investment advice. Confirm tax residence, filer status and current official rules with a qualified professional before filing or acting. Mixed-currency portfolios are deliberately not added into one total.</p>
  </div>;
}
