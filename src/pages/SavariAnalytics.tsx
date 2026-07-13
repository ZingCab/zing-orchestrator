import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Link } from "react-router-dom";
import {
  ArrowLeft, MapPin, IndianRupee, Route, Percent, TrendingUp, Car, Wallet,
} from "lucide-react";
import { LoadingSpinner } from "@/components/LoadingState";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, PieChart, Pie, Cell,
} from "recharts";
import "@/styles/metalcloud.css";

/* ── Brand palette (mirrors metalcloud.css tokens; recharts needs literals) ── */
const C = {
  blue600: "#1579be", blue400: "#73afd8", blue200: "#d0e4f2", blue800: "#0d4972",
  grey300: "#cccccc", grey500: "#999999", green: "#2ba24c", amber: "#d58c00",
  red: "#e43e2b", teal: "#009797",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ymLabel = (ym: string) => {
  const [y, m] = ym.split("-");
  return `${MONTHS[Number(m) - 1]} ${y.slice(2)}`;
};
const inr = (n: number) => `₹${Math.round(n || 0).toLocaleString("en-IN")}`;
const inrShort = (n: number) =>
  n >= 1e7 ? `₹${(n / 1e7).toFixed(2)}Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)}L` : n >= 1e3 ? `₹${(n / 1e3).toFixed(0)}k` : `₹${n}`;

/* Follow the app's dark-mode class on <html> so the scoped theme matches. */
// Savari section defaults to dark. Still reacts if the app ever sets `light`.
function useDark() {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    const el = document.documentElement;
    const compute = () => setDark(!el.classList.contains("light"));
    compute();
    const obs = new MutationObserver(compute);
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

type Grp = { key: string; trips: number; payout: number; avgPayout: number; avgCutPct: number };
type Payment = { status: string; trips: number; payout: number };
type Month = { ym: string; trips: number; earned: number; byType: Record<string, number>; partial: boolean };

/* ── Small building blocks ─────────────────────────────────────────────── */
function Kpi({ label, value, sub, icon: Icon }: { label: string; value: string; sub?: string; icon: any }) {
  return (
    <div className="mc-card" style={{ padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span className="mc-overline">{label}</span>
        <Icon size={16} style={{ color: "var(--text-body-secondary)" }} />
      </div>
      <div className="mc-num" style={{ font: "700 28px/1 var(--font-body)", color: "var(--text-heading)" }}>{value}</div>
      {sub && <div style={{ font: "500 11px var(--font-body)", color: "var(--text-body-secondary)", marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

function Panel({ title, sub, right, children }: { title: string; sub?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mc-card">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 18, gap: 12 }}>
        <div>
          <h3 style={{ font: "700 16px/1.2 var(--font-heading)" }}>{title}</h3>
          {sub && <p style={{ font: "400 12px var(--font-body)", color: "var(--text-body-secondary)", marginTop: 4 }}>{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

/* Horizontal ranked-bar list — reads instantly, all values exact. */
function BarList({ rows, max, unit }: { rows: { label: string; value: number; note?: string }[]; max: number; unit?: (n: number) => string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {rows.map((r) => (
        <div key={r.label}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4, gap: 8 }}>
            <span style={{ font: "500 12px var(--font-body)", color: "var(--text-body)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
            <span className="mc-num" style={{ font: "600 12px var(--font-body)", color: "var(--text-heading)", flexShrink: 0 }}>
              {unit ? unit(r.value) : r.value}{r.note && <span style={{ color: "var(--text-body-secondary)", fontWeight: 500 }}> · {r.note}</span>}
            </span>
          </div>
          <div style={{ height: 8, borderRadius: 9999, background: "var(--surface-table-header)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${max > 0 ? (r.value / max) * 100 : 0}%`, background: "var(--blue-600)", borderRadius: 9999, transition: "width 160ms ease-out" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function heatCell(v: number, max: number) {
  if (!v) return { bg: "transparent", color: "var(--text-body-secondary)" };
  const r = max > 0 ? v / max : 0;
  if (r >= 0.66) return { bg: C.blue600, color: "#fff" };
  if (r >= 0.33) return { bg: C.blue400, color: "#082033" };
  return { bg: C.blue200, color: C.blue800 };
}

export default function SavariAnalytics() {
  const dark = useDark();
  const { data, isLoading } = useQuery({ queryKey: ["savari-analytics"], queryFn: api.getSavariAnalyticsDashboard });

  const summary = data?.summary;
  const byCity: Grp[] = data?.byCity || [];
  const byTripType: Grp[] = data?.byTripType || [];
  const byCarType: Grp[] = data?.byCarType || [];
  const byPayment: Payment[] = data?.byPayment || [];
  const monthly: Month[] = data?.monthlySeries || [];
  const matrix: Record<string, Record<string, number>> = data?.matrix || {};
  const tripTypes: string[] = data?.tripTypes || [];
  const recent: any[] = data?.recent || [];
  const range = data?.dateRange;

  const axisColor = dark ? "#999" : "#808080";
  const gridColor = dark ? "#2f2f2f" : "#e6e6e6";

  const monthChart = useMemo(
    () => monthly.map((m) => ({ label: ymLabel(m.ym) + (m.partial ? " *" : ""), trips: m.trips, earned: m.earned, partial: m.partial })),
    [monthly]
  );

  const carTypes = useMemo(() => Object.keys(matrix), [matrix]);
  const heatMax = useMemo(() => {
    let mx = 1;
    for (const c of Object.values(matrix)) for (const v of Object.values(c)) if (v > mx) mx = v;
    return mx;
  }, [matrix]);

  const paymentColor = (s: string) => {
    const l = s.toLowerCase();
    if (l.includes("pre")) return C.teal;
    if (l.includes("advance")) return C.green;
    if (l.includes("not")) return C.amber;
    return C.grey500;
  };

  const tt = {
    contentStyle: {
      fontFamily: "Oxanium", fontSize: 12, borderRadius: 12, padding: "8px 12px",
      background: dark ? "#161616" : "#fff", border: `1px solid ${gridColor}`,
      color: dark ? "#e6e6e6" : "#1a1a1a", boxShadow: "0 8px 24px rgba(0,0,0,.12)",
    },
    labelStyle: { fontFamily: "Urbanist", fontWeight: 700, color: dark ? "#f2f2f2" : "#0d0d0d" },
  };

  if (isLoading) return <div className="mc"><LoadingSpinner label="Loading Savari analytics…" /></div>;
  if (!data) return <div className="mc" style={{ padding: 48, textAlign: "center", color: "var(--text-body-secondary)" }}>No data yet.</div>;

  const rangeLabel =
    range?.first && range?.last
      ? `${new Date(range.first).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} – ${new Date(range.last).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`
      : "";

  return (
    <div className={dark ? "mc dark" : "mc"} style={{ background: "var(--surface-page)", minHeight: "100vh" }}>
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "24px 20px 96px", display: "flex", flexDirection: "column", gap: 24 }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Link to="/savari" className="mc-btn mc-btn-ghost" style={{ width: 40, padding: 0, justifyContent: "center", borderRadius: 9999 }} aria-label="Back">
            <ArrowLeft size={18} />
          </Link>
          <div style={{ flex: 1 }}>
            <span className="mc-overline">Savari · Vendor Intelligence</span>
            <h1 style={{ font: "800 24px/1.1 var(--font-heading)", marginTop: 2 }}>Booking Analytics</h1>
          </div>
          {rangeLabel && (
            <div style={{ textAlign: "right" }}>
              <div className="mc-overline">Data range</div>
              <div className="mc-num" style={{ font: "600 12px var(--font-body)", color: "var(--text-body)", marginTop: 2 }}>{rangeLabel}</div>
            </div>
          )}
        </div>

        {/* KPIs — exact all-time totals */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
          <Kpi label="Total bookings" value={summary.totalTrips.toLocaleString("en-IN")} sub="broadcasts captured" icon={Route} />
          <Kpi label="Total vendor payout" value={inrShort(summary.totalEarned)} sub={inr(summary.totalEarned)} icon={IndianRupee} />
          <Kpi label="Avg payout / trip" value={inr(summary.avgPayout)} sub="vendor take per booking" icon={Wallet} />
          <Kpi label="Avg platform cut" value={`${summary.avgSavariCutPct}%`} sub="Savari commission" icon={Percent} />
        </div>

        {/* Demand + revenue over time */}
        <Panel title="Demand & revenue over time" sub="Bookings first seen per month (by capture date). Bars = bookings, line = vendor payout.">
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={monthChart} margin={{ top: 8, right: 8, left: -8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fontFamily: "Oxanium", fill: axisColor }} tickLine={false} axisLine={{ stroke: gridColor }} />
                <YAxis yAxisId="l" tick={{ fontSize: 11, fontFamily: "Oxanium", fill: axisColor }} tickLine={false} axisLine={false} />
                <YAxis yAxisId="r" orientation="right" tickFormatter={inrShort} tick={{ fontSize: 11, fontFamily: "Oxanium", fill: axisColor }} tickLine={false} axisLine={false} />
                <Tooltip {...tt} formatter={(v: number, n: string) => [n === "Payout" ? inr(v) : v.toLocaleString("en-IN"), n]} cursor={{ fill: dark ? "#ffffff10" : "#00000008" }} />
                <Bar yAxisId="l" dataKey="trips" name="Bookings" radius={[6, 6, 0, 0]} maxBarSize={54}>
                  {monthChart.map((m, i) => <Cell key={i} fill={m.partial ? C.blue200 : C.blue600} />)}
                </Bar>
                <Line yAxisId="r" dataKey="earned" name="Payout" stroke={C.teal} strokeWidth={2.5} dot={{ r: 3, fill: C.teal }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p style={{ font: "400 11px var(--font-body)", color: "var(--text-body-secondary)", marginTop: 10 }}>
            * current month is still in progress — shown lighter; do not read as a decline.
          </p>
        </Panel>

        {/* Geography + trip-type economics */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 24 }}>
          <Panel title="Where the demand is" sub="Top pickup cities by booking volume — position drivers here.">
            <BarList
              max={byCity[0]?.trips || 1}
              rows={byCity.map((c) => ({ label: c.key, value: c.trips, note: `${inr(c.avgPayout)} avg` }))}
            />
          </Panel>

          <Panel title="Trip-type economics" sub="Volume vs value. High avg payout with decent volume = best to chase.">
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {byTripType.map((t) => (
                <div key={t.key}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                    <span style={{ font: "600 12px var(--font-heading)", color: "var(--text-heading)" }}>{t.key}</span>
                    <span className="mc-num" style={{ font: "600 12px var(--font-body)", color: "var(--text-heading)" }}>
                      {inr(t.avgPayout)}<span style={{ color: "var(--text-body-secondary)", fontWeight: 500 }}> avg · {t.avgCutPct}% cut</span>
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1, height: 8, borderRadius: 9999, background: "var(--surface-table-header)", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${((t.trips / (byTripType[0]?.trips || 1)) * 100)}%`, background: "var(--blue-600)", borderRadius: 9999 }} />
                    </div>
                    <span className="mc-num" style={{ font: "500 11px var(--font-body)", color: "var(--text-body-secondary)", width: 64, textAlign: "right" }}>{t.trips} trips</span>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        {/* Car demand + payment mix */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 24 }}>
          <Panel title="Vehicle demand" sub="Which car classes are requested most — shape the fleet to match.">
            <BarList
              max={byCarType[0]?.trips || 1}
              rows={byCarType.map((c) => ({ label: c.key, value: c.trips, note: `${inr(c.avgPayout)} avg` }))}
            />
          </Panel>

          <Panel title="Payment mix" sub="Cash-flow signal. Advance / Pre-paid are lower risk than Not-paid.">
            <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
              <div style={{ width: 160, height: 160 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={byPayment} dataKey="trips" nameKey="status" innerRadius={45} outerRadius={72} paddingAngle={2} strokeWidth={0}>
                      {byPayment.map((p) => <Cell key={p.status} fill={paymentColor(p.status)} />)}
                    </Pie>
                    <Tooltip {...tt} formatter={(v: number, _n, e: any) => [`${v} trips · ${inr(e.payload.payout)}`, e.payload.status]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ flex: 1, minWidth: 140, display: "flex", flexDirection: "column", gap: 10 }}>
                {byPayment.map((p) => {
                  const pct = Math.round((p.trips / summary.totalTrips) * 100);
                  return (
                    <div key={p.status} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: paymentColor(p.status), flexShrink: 0 }} />
                      <span style={{ font: "500 12px var(--font-body)", color: "var(--text-body)", flex: 1 }}>{p.status}</span>
                      <span className="mc-num" style={{ font: "600 12px var(--font-body)", color: "var(--text-heading)" }}>{pct}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </Panel>
        </div>

        {/* Demand matrix */}
        <Panel title="Demand matrix" sub="Bookings per vehicle × trip type — darker = higher demand. Every cell is an exact count.">
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", font: "600 11px var(--font-body)", color: "var(--text-body-secondary)", padding: "0 8px 10px 0", whiteSpace: "nowrap" }}>Vehicle</th>
                  {tripTypes.map((t) => (
                    <th key={t} style={{ font: "700 10px var(--font-body)", letterSpacing: ".05em", textTransform: "uppercase", color: "var(--text-body-secondary)", padding: "0 4px 10px", textAlign: "center", whiteSpace: "nowrap" }}>{t}</th>
                  ))}
                  <th style={{ font: "700 10px var(--font-body)", textTransform: "uppercase", color: "var(--text-heading)", padding: "0 0 10px 8px", textAlign: "center" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {carTypes.map((car) => {
                  const row = matrix[car] || {};
                  const total = Object.values(row).reduce((s, v) => s + v, 0);
                  return (
                    <tr key={car} style={{ borderTop: "1px solid var(--stroke-primary)" }}>
                      <td style={{ padding: "8px 8px 8px 0", font: "500 12px var(--font-body)", color: "var(--text-body)", whiteSpace: "nowrap" }}>{car}</td>
                      {tripTypes.map((t) => {
                        const v = row[t] || 0;
                        const cs = heatCell(v, heatMax);
                        return (
                          <td key={t} style={{ padding: "6px 4px", textAlign: "center" }}>
                            <span className="mc-num" style={{ display: "inline-flex", minWidth: 30, justifyContent: "center", padding: "3px 6px", borderRadius: 8, font: "600 11px var(--font-body)", background: cs.bg, color: cs.color }}>{v || ""}</span>
                          </td>
                        );
                      })}
                      <td className="mc-num" style={{ padding: "8px 0 8px 8px", textAlign: "center", font: "700 12px var(--font-body)", color: "var(--text-heading)" }}>{total}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        {/* Recent bookings — fields fixed to match API (snake_case) */}
        <Panel title="Recent bookings" sub="Latest 50 broadcasts captured from the Savari feed.">
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
              <thead>
                <tr style={{ background: "var(--surface-table-header)" }}>
                  {["Booking", "Trip date", "Type", "Vehicle", "City", "Payout", "Total", "Cut %", "Payment"].map((h, i) => (
                    <th key={h} style={{ font: "600 10px var(--font-body)", letterSpacing: ".04em", textTransform: "uppercase", color: "var(--text-body-secondary)", padding: "10px 12px", textAlign: i >= 5 && i <= 7 ? "right" : "left", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recent.map((b, i) => (
                  <tr key={b.bookingId || i} style={{ borderTop: "1px solid var(--stroke-primary)" }}>
                    <td className="mc-num" style={{ padding: "9px 12px", font: "600 11px var(--font-body)", color: "var(--blue-600)", whiteSpace: "nowrap" }}>{b.bookingId}</td>
                    <td className="mc-num" style={{ padding: "9px 12px", font: "500 11px var(--font-body)", color: "var(--text-body)", whiteSpace: "nowrap" }}>{b.startDate || "—"}</td>
                    <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}>
                      <span className="mc-chip" style={{ background: "var(--surface-hover)", color: "var(--blue-800)" }}>{b.tripTypeName}</span>
                    </td>
                    <td style={{ padding: "9px 12px", font: "500 11px var(--font-body)", color: "var(--text-body)", whiteSpace: "nowrap" }}>{b.carType}</td>
                    <td style={{ padding: "9px 12px", font: "500 11px var(--font-body)", color: "var(--text-body)", whiteSpace: "nowrap" }}>{b.pickCity}</td>
                    <td className="mc-num" style={{ padding: "9px 12px", font: "600 11px var(--font-body)", color: "var(--text-heading)", textAlign: "right", whiteSpace: "nowrap" }}>{inr(b.vendorCost)}</td>
                    <td className="mc-num" style={{ padding: "9px 12px", font: "500 11px var(--font-body)", color: "var(--text-body-secondary)", textAlign: "right", whiteSpace: "nowrap" }}>{inr(b.totalAmt)}</td>
                    <td className="mc-num" style={{ padding: "9px 12px", font: "500 11px var(--font-body)", color: "var(--text-body)", textAlign: "right" }}>{b.savariCutPct}%</td>
                    <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}>
                      <span className="mc-chip" style={{ background: `${paymentColor(b.paymentStatus || "")}22`, color: paymentColor(b.paymentStatus || "") }}>{b.paymentStatus || "—"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}
