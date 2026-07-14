import { type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Radio, Bot, LineChart, RefreshCw, Wallet, Bell, ShieldAlert, Zap } from "lucide-react";
import { api } from "@/lib/api";
import { useMcDark } from "@/hooks/useMcDark";
import "@/styles/metalcloud.css";

const NAV = [
  { to: "/savari", key: "feed", label: "Live Feed", icon: Radio },
  { to: "/savari/bot", key: "bot", label: "Bot", icon: Bot },
  { to: "/savari/analytics", key: "analytics", label: "Analytics", icon: LineChart },
];

const inr = (n: number) => `₹${Math.round(n || 0).toLocaleString("en-IN")}`;

export function SavariShell({
  active,
  title,
  subtitle,
  actions,
  children,
}: {
  active: "feed" | "bot" | "analytics";
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const dark = useMcDark();
  const qc = useQueryClient();
  const loc = useLocation();

  // Global operational status — shares the feed query (cached, deduped).
  const status = useQuery({
    queryKey: ["savaari", "broadcasts"],
    queryFn: () => api.getSavaariBroadcasts({ booking_id: "0" }),
    staleTime: 60_000,
    retry: 1,
  });
  const rs = (status.data?.resultset || {}) as Record<string, any>;
  const balance = Number(rs.currentBalance ?? rs.CurrentBalance ?? NaN);
  const alerts = Number(rs.businessAlertCount ?? 0);
  const alertAmt = Number(rs.businessAlertAmount ?? 0);
  const kyc = String(rs.vendorUrgentMessage ?? "").trim();
  const office = String(rs.officeName ?? "").trim();
  const negative = Number.isFinite(balance) && balance < 0;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["savaari"] });
    qc.invalidateQueries({ queryKey: ["savari-bot"] });
    qc.invalidateQueries({ queryKey: ["savari-analytics"] });
  };

  const isActive = (key: string, to: string) =>
    active === key || loc.pathname === to;

  return (
    <div className={`mc ${dark ? "dark " : ""}sv-shell`}>
      {/* ── Sidebar (desktop) ─────────────────────────────── */}
      <aside className="sv-sidebar">
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 8px 18px" }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: "var(--surface-action)", display: "grid", placeItems: "center", flexShrink: 0 }}>
            <Zap size={18} color="#fff" />
          </div>
          <div>
            <div style={{ font: "800 15px/1 var(--font-heading)", color: "var(--text-heading)" }}>Savari Ops</div>
            <div style={{ font: "500 10px var(--font-body)", color: "var(--text-body-secondary)", marginTop: 2 }}>ZingCab vendor suite</div>
          </div>
        </div>

        <nav style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {NAV.map((n) => (
            <Link key={n.key} to={n.to} className="sv-navitem" data-active={isActive(n.key, n.to)}>
              <n.icon size={17} /> {n.label}
            </Link>
          ))}
        </nav>

        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8, padding: "8px" }}>
          {office && (
            <div>
              <div className="mc-overline">Vendor</div>
              <div style={{ font: "600 12px var(--font-body)", color: "var(--text-body)", marginTop: 2 }}>{office}</div>
            </div>
          )}
          {Number.isFinite(balance) && (
            <div className="sv-statuschip" style={{ justifyContent: "space-between", background: negative ? "var(--chip-error-bg)" : "var(--surface-table-header)", color: negative ? "var(--chip-error-fg)" : "var(--text-body)" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><Wallet size={14} /> Balance</span>
              <span className="mc-num" style={{ fontWeight: 700 }}>{inr(balance)}</span>
            </div>
          )}
        </div>
      </aside>

      {/* ── Main ──────────────────────────────────────────── */}
      <div className="sv-main">
        <header className="sv-topbar">
          <div style={{ flex: 1, minWidth: 0 }}>
            <span className="mc-overline">Savari</span>
            <h1 style={{ font: "800 20px/1.1 var(--font-heading)", color: "var(--text-heading)" }}>{title}</h1>
            {subtitle && <p style={{ font: "400 12px var(--font-body)", color: "var(--text-body-secondary)", marginTop: 2 }}>{subtitle}</p>}
          </div>
          {actions}
          <button className="mc-btn mc-btn-ghost" style={{ width: 40, padding: 0, justifyContent: "center" }}
            onClick={refresh} disabled={status.isFetching} aria-label="Refresh">
            <RefreshCw size={16} className={status.isFetching ? "animate-spin" : ""} />
          </button>
        </header>

        <main className="sv-content">
          {/* Global status strip */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 20 }}>
            <span className="sv-statuschip" style={{ background: negative ? "var(--chip-error-bg)" : "var(--surface-table-header)", color: negative ? "var(--chip-error-fg)" : "var(--text-body)" }}>
              <Wallet size={14} /> Balance
              <span className="mc-num" style={{ fontWeight: 700 }}>{Number.isFinite(balance) ? inr(balance) : "—"}</span>
              {negative && <span style={{ opacity: 0.85 }}>· low</span>}
            </span>
            <span className="sv-statuschip">
              <Bell size={14} style={{ color: "var(--chip-info-fg)" }} /> Alerts today
              <span className="mc-num" style={{ fontWeight: 700 }}>{alerts}</span>
              {alertAmt > 0 && <span className="mc-num" style={{ color: "var(--text-body-secondary)" }}>· {inr(alertAmt)}</span>}
            </span>
            {kyc && (
              <span className="sv-statuschip" style={{ background: "var(--chip-warn-bg)", color: "var(--chip-warn-fg)", cursor: "help" }} title={kyc.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}>
                <ShieldAlert size={14} /> KYC / action required
              </span>
            )}
          </div>

          {children}
        </main>

        {/* ── Bottom nav (mobile) ─────────────────────────── */}
        <nav className="sv-bottomnav">
          {NAV.map((n) => (
            <Link key={n.key} to={n.to} data-active={isActive(n.key, n.to)}>
              <n.icon size={19} /> {n.label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
