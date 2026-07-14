import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Wallet, Receipt, ArrowDownToLine, ArrowUpFromLine, PiggyBank, type LucideIcon } from "lucide-react";
import { LoadingSpinner } from "@/components/LoadingState";
import { SavariShell } from "@/components/SavariShell";

const inr = (n: number) => `₹${Math.round(n || 0).toLocaleString("en-IN")}`;

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
      <span className="mc-overline" style={{ color: "var(--text-body-secondary)" }}>{children}</span>
      <span style={{ flex: 1, height: 1, background: "var(--stroke-primary)" }} />
    </div>
  );
}

function Kpi({ label, value, sub, icon: Icon, tone }: { label: string; value: string; sub?: string; icon: LucideIcon; tone?: string }) {
  return (
    <div className="mc-card" style={{ padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span className="mc-overline">{label}</span>
        <Icon size={16} style={{ color: tone || "var(--text-body-secondary)" }} />
      </div>
      <div className="mc-num" style={{ font: "700 26px/1 var(--font-body)", color: tone || "var(--text-heading)" }}>{value}</div>
      {sub && <div style={{ font: "500 11px var(--font-body)", color: "var(--text-body-secondary)", marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--stroke-primary)" }}>
      <span style={{ font: "500 13px var(--font-body)", color: "var(--text-body)" }}>{label}</span>
      <span className="mc-num" style={{ font: "600 13px var(--font-body)", color: tone || "var(--text-heading)" }}>{value}</span>
    </div>
  );
}

function Panel({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="mc-card">
      <div style={{ marginBottom: 12 }}>
        <h3 style={{ font: "700 16px/1.2 var(--font-heading)" }}>{title}</h3>
        {sub && <p style={{ font: "400 12px var(--font-body)", color: "var(--text-body-secondary)", marginTop: 4 }}>{sub}</p>}
      </div>
      {children}
    </div>
  );
}

export default function SavariFinance() {
  const q = useQuery({
    queryKey: ["savaari", "broadcasts"],
    queryFn: () => api.getSavaariBroadcasts({ booking_id: "0" }),
  });

  const rs = (q.data?.resultset || {}) as Record<string, any>;
  const ra = (rs.resultArray || {}) as Record<string, any>;
  const num = (v: any) => Number(v || 0);

  const balance = num(rs.currentBalance ?? rs.CurrentBalance);
  const netDue = num(ra.netdueAmount);
  const balanceAsOnDay = num(ra.balanceAsOnDay);
  const deposit = num(ra.depositamount);
  const tdsPending = num(ra.pendingTdsToBeDeducted);
  const tdsPct = ra.pendingTdsPercentage;
  const ctcPending = num(ra.ctcPendingTotal);
  const ctcNotStarted = num(ra.ctcTripsNotstarted);
  const ctcNotCompleted = num(ra.ctcTripsNotcompleted);
  const office = ra.officeName || "";

  if (q.isLoading) return <SavariShell active="finance" title="Finance"><LoadingSpinner label="Loading finance data…" /></SavariShell>;

  return (
    <SavariShell active="finance" title="Finance" subtitle={office ? `${office} · balance & payouts` : "Balance, TDS & cash-to-collect"}>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <SectionLabel>Balance</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
          <Kpi label="Current balance" value={inr(balance)} sub={balance < 0 ? "negative — top up recommended" : "healthy"} icon={Wallet} tone={balance < 0 ? "var(--red-600)" : "var(--green-600)"} />
          <Kpi label="Net due" value={inr(netDue)} sub="settle to clear balance" icon={Receipt} />
          <Kpi label="Balance as on day" value={inr(balanceAsOnDay)} icon={Wallet} />
          <Kpi label="Security deposit" value={inr(deposit)} icon={PiggyBank} />
        </div>

        <SectionLabel>TDS</SectionLabel>
        <Panel title="Pending TDS" sub="Tax deducted at source, withheld from future payouts.">
          <Row label="Pending TDS to be deducted" value={inr(tdsPending)} tone={tdsPending > 0 ? "var(--yellow-600)" : undefined} />
          <Row label="TDS rate" value={tdsPct ? `${tdsPct}%` : "—"} />
        </Panel>

        <SectionLabel>Cash to collect</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
          <Kpi label="Total pending" value={inr(ctcPending)} icon={ArrowDownToLine} tone="var(--blue-600)" />
          <Kpi label="Trips not started" value={inr(ctcNotStarted)} icon={ArrowDownToLine} />
          <Kpi label="Trips not completed" value={inr(ctcNotCompleted)} icon={ArrowUpFromLine} />
        </div>

        <SectionLabel>Payment activity (all-time)</SectionLabel>
        <Panel title="Pre-search period" sub={ra.preSearchDateRange || "Cumulative history"}>
          <Row label="Payment captured" value={inr(num(ra.preSearchPeriodPaymentCapture))} tone="var(--green-600)" />
          <Row label="Payment refunded" value={inr(num(ra.preSearchPeriodPaymentRefund))} tone="var(--red-600)" />
          <Row label="Payout issued" value={inr(num(ra.preSearchPeriodPayoutIssue))} />
          <Row label="Closing balance" value={inr(num(ra.preSearchPeriodBalance))} />
        </Panel>

        <Panel title="Current period" sub={ra.searchDateRange || "Today"}>
          <Row label="Payment captured" value={inr(num(ra.searchPeriodPaymentCapture))} tone="var(--green-600)" />
          <Row label="Payment refunded" value={inr(num(ra.searchPeriodPaymentRefund))} tone="var(--red-600)" />
          <Row label="Payout issued" value={inr(num(ra.searchPeriodPayoutIssue))} />
          <Row label="Closing balance" value={inr(num(ra.searchPeriodBalance))} />
        </Panel>
      </div>
    </SavariShell>
  );
}
