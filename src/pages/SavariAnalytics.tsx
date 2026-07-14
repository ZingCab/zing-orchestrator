import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { IndianRupee, Route, Percent, Wallet, MapPin, TrendingUp, AlertTriangle, type LucideIcon } from "lucide-react";
import { LoadingSpinner } from "@/components/LoadingState";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, PieChart, Pie, Cell,
} from "recharts";
import { SavariShell } from "@/components/SavariShell";
import { useMcDark } from "@/hooks/useMcDark";

/* ── Brand palette ─────────────────────────────────────────────────────── */
const C = {
  blue600: "#1579be", blue400: "#73afd8", blue200: "#d0e4f2", blue800: "#0d4972",
  grey500: "#999999", green: "#2ba24c", amber: "#d58c00", red: "#e43e2b",
  teal: "#009797", purple: "#9636e1",
};

const TRIP_COLORS: Record<string, string> = {
  "One Way Drop": C.blue600,
  "Round Trip": C.teal,
  "Local 8hr": C.blue400,
  "Local 12hr": C.purple,
  "Local 4hr": C.blue800,
  "Transfer": C.amber,
  "Other": C.grey500,
};
const tripColor = (t: string) => TRIP_COLORS[t] || C.grey500;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ymLabel = (ym: string) => {
  const [y, m] = ym.split("-");
  return `${MONTHS[Number(m) - 1]} ${y.slice(2)}`;
};
const inr = (n: number) => `₹${Math.round(n || 0).toLocaleString("en-IN")}`;
const inrShort = (n: number) =>
  n >= 1e7 ? `₹${(n / 1e7).toFixed(2)}Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)}L` : n >= 1e3 ? `₹${(n / 1e3).toFixed(0)}k` : `₹${n}`;

type IconType = LucideIcon;
type Grp = { key: string; trips: number; payout: number; avgPayout: number; avgCutPct: number };
type Payment = { status: string; trips: number; payout: number };
type Month = { ym: string; trips: number; earned: number; byType: Record<string, number>; partial: boolean };

/* ── Building blocks ───────────────────────────────────────────────────── */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
      <span className="mc-overline" style={{ color: "var(--text-body-secondary)" }}>{children}</span>
      <span style={{ flex: 1, height: 1, background: "var(--stroke-primary)" }} />
    </div>
  );
}

function Sparkline({ data, color, height = 34 }: { data: number[]; color: string; height?: number }) {
  if (data.length < 2) return <div style={{ height }} />;
  const max = Math.max(...data), min = Math.min(...data);
  const range = max - min || 1;
  const w = 100;
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / range) * (height - 4) - 2).toFixed(1)}`);
  const area = `0,${height} ${pts.join(" ")} ${w},${height}`;
  const gid = `sg-${color.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ width: "100%", height, display: "block" }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gid})`} />
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Kpi({ label, value, sub, icon: Icon, spark, sparkColor }: { label: string; value: string; sub?: string; icon: IconType; spark?: number[]; sparkColor?: string }) {
  return (
    <div className="mc-card" style={{ padding: 20, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span className="mc-overline">{label}</span>
        <Icon size={16} style={{ color: "var(--text-body-secondary)" }} />
      </div>
      <div className="mc-num" style={{ font: "700 28px/1 var(--font-body)", color: "var(--text-heading)" }}>{value}</div>
      {sub && <div style={{ font: "500 11px var(--font-body)", color: "var(--text-body-secondary)", marginTop: 6 }}>{sub}</div>}
      {spark && spark.length > 1 && (
        <div style={{ marginTop: 12, marginLeft: -2, marginRight: -2 }}><Sparkline data={spark} color={sparkColor || C.blue400} /></div>
      )}
    </div>
  );
}

function InsightCard({ icon: Icon, tone, label, head, note }: { icon: IconType; tone: string; label: string; head: string; note: string }) {
  return (
    <div className="mc-card" style={{ padding: 18, display: "flex", gap: 14 }}>
      <div style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0, display: "grid", placeItems: "center", background: `${tone}1f`, color: tone }}>
        <Icon size={19} />
      </div>
      <div style={{ minWidth: 0 }}>
        <span className="mc-overline">{label}</span>
        <p style={{ font: "700 14px/1.3 var(--font-heading)", color: "var(--text-heading)", margin: "3px 0 5px" }}>{head}</p>
        <p style={{ font: "400 12px/1.5 var(--font-body)", color: "var(--text-body-secondary)" }}>{note}</p>
      </div>
    </div>
  );
}

function Panel({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="mc-card">
      <div style={{ marginBottom: 18 }}>
        <h3 style={{ font: "700 16px/1.2 var(--font-heading)" }}>{title}</h3>
        {sub && <p style={{ font: "400 12px var(--font-body)", color: "var(--text-body-secondary)", marginTop: 4 }}>{sub}</p>}
      </div>
      {children}
    </div>
  );
}

function BarList({ rows, max }: { rows: { label: string; value: number; note?: string }[]; max: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {rows.map((r) => (
        <div key={r.label}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4, gap: 8 }}>
            <span style={{ font: "500 12px var(--font-body)", color: "var(--text-body)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
            <span className="mc-num" style={{ font: "600 12px var(--font-body)", color: "var(--text-heading)", flexShrink: 0 }}>
              {r.value}{r.note && <span style={{ color: "var(--text-body-secondary)", fontWeight: 500 }}> · {r.note}</span>}
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
  const dark = useMcDark();
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
  const dowHour: number[][] = data?.demandHeatmap?.byDowHour || [];

  const axisColor = dark ? "#999" : "#808080";
  const gridColor = dark ? "#2f2f2f" : "#e6e6e6";

  const monthChart = useMemo(
    () => monthly.map((m) => ({
      label: ymLabel(m.ym) + (m.partial ? " *" : ""),
      trips: m.trips, earned: m.earned, partial: m.partial, ...m.byType,
    })),
    [monthly]
  );
  const hasPartial = monthly.some((m) => m.partial);
  const tripsSpark = useMemo(() => monthly.map((m) => m.trips), [monthly]);
  const earnedSpark = useMemo(() => monthly.map((m) => m.earned), [monthly]);

  // Auto-generated, data-driven takeaways — turns the numbers into decisions.
  const insights = useMemo(() => {
    if (!summary) return [];
    const out: { icon: IconType; tone: string; label: string; head: string; note: string }[] = [];
    const total = summary.totalTrips || 1;

    if (byCity.length) {
      const top = byCity[0];
      const pct = Math.round((top.trips / total) * 100);
      out.push({
        icon: MapPin, tone: C.blue600, label: "Top market",
        head: `${top.key.split(",")[0]} — ${pct}% of all demand`,
        note: `${top.trips.toLocaleString("en-IN")} bookings · ${inr(top.avgPayout)} avg payout. Keep drivers positioned here.`,
      });
    }

    const volLeader = byTripType[0];
    const valLeader = [...byTripType].filter((t) => t.trips >= 5).sort((a, b) => b.avgPayout - a.avgPayout)[0];
    if (valLeader && volLeader) {
      const mult = volLeader.avgPayout ? valLeader.avgPayout / volLeader.avgPayout : 1;
      out.push({
        icon: TrendingUp, tone: C.teal, label: "Best value",
        head: `${valLeader.key} pays ${inr(valLeader.avgPayout)}/trip`,
        note: mult >= 1.15
          ? `${mult.toFixed(1)}× the ${volLeader.key} average — prioritise bidding on these.`
          : `Highest avg payout with real volume — worth chasing.`,
      });
    }

    const notPaid = byPayment.find((p) => /not/i.test(p.status));
    if (notPaid) {
      const pct = Math.round((notPaid.trips / total) * 100);
      out.push({
        icon: AlertTriangle, tone: C.amber, label: "Cash-flow risk",
        head: `${pct}% of bookings are “Not Paid”`,
        note: `${notPaid.trips.toLocaleString("en-IN")} trips · ${inr(notPaid.payout)} collected on delivery. Watch exposure.`,
      });
    }
    return out;
  }, [summary, byCity, byTripType, byPayment]);

  const dowHourMax = useMemo(() => {
    let mx = 1;
    for (const row of dowHour) for (const v of row) if (v > mx) mx = v;
    return mx;
  }, [dowHour]);
  const busiestSlot = useMemo(() => {
    let best = { d: 0, h: 0, v: -1 };
    dowHour.forEach((row, d) => row.forEach((v, h) => { if (v > best.v) best = { d, h, v }; }));
    return best.v > 0 ? best : null;
  }, [dowHour]);

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

  const rangeLabel =
    range?.first && range?.last
      ? `${new Date(range.first).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} – ${new Date(range.last).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`
      : undefined;

  if (isLoading || !data) {
    return (
      <SavariShell active="analytics" title="Booking Analytics">
        {isLoading ? <LoadingSpinner label="Loading analytics…" /> : <div style={{ padding: 48, textAlign: "center", color: "var(--text-body-secondary)" }}>No data yet.</div>}
      </SavariShell>
    );
  }

  return (
    <SavariShell active="analytics" title="Booking Analytics" subtitle={rangeLabel ? `Broadcasts captured · ${rangeLabel}` : undefined}>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {/* OVERVIEW */}
        <SectionLabel>Overview</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
          <Kpi label="Total bookings" value={summary.totalTrips.toLocaleString("en-IN")} sub="broadcasts captured" icon={Route} spark={tripsSpark} sparkColor={C.blue400} />
          <Kpi label="Total vendor payout" value={inrShort(summary.totalEarned)} sub={inr(summary.totalEarned)} icon={IndianRupee} spark={earnedSpark} sparkColor={C.teal} />
          <Kpi label="Avg payout / trip" value={inr(summary.avgPayout)} sub="vendor take per booking" icon={Wallet} />
          <Kpi label="Avg platform cut" value={`${summary.avgSavariCutPct}%`} sub="Savari commission" icon={Percent} />
        </div>

        {/* KEY INSIGHTS — auto-generated takeaways */}
        {insights.length > 0 && (
          <>
            <SectionLabel>Key insights</SectionLabel>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
              {insights.map((ins, i) => <InsightCard key={i} {...ins} />)}
            </div>
          </>
        )}

        {/* TRENDS */}
        <SectionLabel>Trends over time</SectionLabel>
        <Panel title="Demand & revenue by month" sub="Bookings (bars) and vendor payout (line), grouped by trip month.">
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
          {hasPartial && (
            <p style={{ font: "400 11px var(--font-body)", color: "var(--text-body-secondary)", marginTop: 10 }}>
              * current &amp; upcoming months are still filling — shown lighter; not a decline.
            </p>
          )}
        </Panel>

        <Panel title="Trip mix by month" sub="How the booking mix shifts month to month — plan the fleet against it.">
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={monthChart} margin={{ top: 8, right: 8, left: -8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fontFamily: "Oxanium", fill: axisColor }} tickLine={false} axisLine={{ stroke: gridColor }} />
                <YAxis tick={{ fontSize: 11, fontFamily: "Oxanium", fill: axisColor }} tickLine={false} axisLine={false} />
                <Tooltip {...tt} cursor={{ fill: dark ? "#ffffff10" : "#00000008" }} />
                {tripTypes.map((t, i) => (
                  <Bar key={t} dataKey={t} name={t} stackId="mix" fill={tripColor(t)}
                    radius={i === tripTypes.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} maxBarSize={54} />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--stroke-primary)" }}>
            {tripTypes.map((t) => (
              <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 6, font: "500 11px var(--font-body)", color: "var(--text-body-secondary)" }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: tripColor(t) }} />{t}
              </span>
            ))}
          </div>
        </Panel>

        {/* DEMAND */}
        <SectionLabel>Where the demand is</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20 }}>
          <Panel title="Top pickup cities" sub="Booking volume by pickup city — position drivers here.">
            <BarList max={byCity[0]?.trips || 1} rows={byCity.map((c) => ({ label: c.key, value: c.trips, note: `${inr(c.avgPayout)} avg` }))} />
          </Panel>
          <Panel title="Vehicle demand" sub="Which car classes are requested most — shape the fleet to match.">
            <BarList max={byCarType[0]?.trips || 1} rows={byCarType.map((c) => ({ label: c.key, value: c.trips, note: `${inr(c.avgPayout)} avg` }))} />
          </Panel>
        </div>

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

        {dowHour.length > 0 && (
          <Panel title="When demand drops" sub="Bookings by day &amp; hour (IST) — staff up before the busy windows.">
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", minWidth: 640 }}>
                <thead>
                  <tr>
                    <th style={{ width: 34 }} />
                    {Array.from({ length: 24 }, (_, h) => (
                      <th key={h} style={{ font: "500 8px var(--font-body)", color: "var(--text-body-secondary)", padding: "0 1px 4px", textAlign: "center" }}>{h % 3 === 0 ? h : ""}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {DAYS.map((d, di) => (
                    <tr key={d}>
                      <td style={{ font: "600 10px var(--font-body)", color: "var(--text-body-secondary)", paddingRight: 8 }}>{d}</td>
                      {(dowHour[di] || []).map((v, h) => {
                        const cs = heatCell(v, dowHourMax);
                        return (
                          <td key={h} style={{ padding: 1.5 }} title={`${d} ${h}:00 IST — ${v} bookings`}>
                            <div style={{ width: 20, height: 16, borderRadius: 3, background: cs.bg || "var(--surface-table-header)" }} />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {busiestSlot && (
              <p style={{ font: "400 11px var(--font-body)", color: "var(--text-body-secondary)", marginTop: 12 }}>
                Busiest: <b style={{ color: "var(--text-body)" }}>{DAYS[busiestSlot.d]} {busiestSlot.h}:00–{busiestSlot.h + 1}:00 IST</b> · {busiestSlot.v} bookings.
              </p>
            )}
          </Panel>
        )}

        {/* ECONOMICS */}
        <SectionLabel>Economics & risk</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20 }}>
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
                      <div style={{ height: "100%", width: `${((t.trips / (byTripType[0]?.trips || 1)) * 100)}%`, background: tripColor(t.key), borderRadius: 9999 }} />
                    </div>
                    <span className="mc-num" style={{ font: "500 11px var(--font-body)", color: "var(--text-body-secondary)", width: 64, textAlign: "right" }}>{t.trips} trips</span>
                  </div>
                </div>
              ))}
            </div>
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

        {/* DETAIL */}
        <SectionLabel>Detail</SectionLabel>
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
                      <span className="mc-chip" style={{ background: `${tripColor(b.tripTypeName)}22`, color: tripColor(b.tripTypeName) }}>{b.tripTypeName}</span>
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
    </SavariShell>
  );
}
