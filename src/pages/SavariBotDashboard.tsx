import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, BarChart3, ChevronDown, TrendingUp, Scan, Filter, Route, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api, ApiError } from "@/lib/api";
import { toast } from "@/hooks/use-toast";
import { applySnapshot, buildSavariPutBody, countEnabledRoutes } from "@/lib/savariBotMapping";
import type { OutstationRoute, RouteDirection, TripToggleId } from "@/data/savariBotDummy";
import "@/styles/metalcloud.css";

const DEFAULT_VENDOR_ID = import.meta.env.VITE_SAVARI_VENDOR_ID || "262882";

const TRIP_LABELS: { id: TripToggleId; title: string; hint: string }[] = [
  { id: "outstation_oneway", title: "Outstation — one way", hint: "City-to-city single direction trips" },
  { id: "outstation_round", title: "Outstation — round trip", hint: "Multi-day return journeys" },
  { id: "local_rental", title: "Local rental", hint: "4hr/40km or 8hr/80km packages" },
  { id: "airport_transfer", title: "Airport / railway transfer", hint: "Point-to-point transfers" },
];

const CONFIG_TABS = [
  { id: "routes", label: "Outstation" },
  { id: "round", label: "Round trip" },
  { id: "rental", label: "Rental" },
  { id: "config", label: "Config" },
] as const;
type ConfigTab = (typeof CONFIG_TABS)[number]["id"];

const INPUT_STYLE: React.CSSProperties = {
  fontFamily: "Oxanium", fontSize: 13, borderRadius: 10,
  borderColor: "var(--stroke-primary)", background: "var(--surface-page)", color: "var(--text-body)",
};

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

export default function SavariBotDashboard() {
  const dark = useDark();
  const queryClient = useQueryClient();
  const [queryVendorId, setQueryVendorId] = useState(DEFAULT_VENDOR_ID);

  const [nextRunSec, setNextRunSec] = useState(120);
  const [running] = useState(true);
  const [configTab, setConfigTab] = useState<ConfigTab>("routes");
  const [toggles, setToggles] = useState<Record<TripToggleId, boolean>>({
    outstation_oneway: false, outstation_round: false, local_rental: false, airport_transfer: false,
  });
  const [direction, setDirection] = useState<RouteDirection>("into_kolkata");
  const [routesOut, setRoutesOut] = useState<OutstationRoute[]>([]);
  const [routesIn, setRoutesIn] = useState<OutstationRoute[]>([]);
  const [roundTrip, setRoundTrip] = useState({ minCostPerKm: 0, minCostPerDay: 0, mileageKmPerL: 0, fuelCostPerL: 0 });
  const [rental, setRental] = useState({ min8h80km: 0, min4h40km: 0 });
  const [botConfig, setBotConfig] = useState({ pollingIntervalMs: 0, vendorId: "", apiUrl: "", carTypes: "" });
  const [vendorLocation, setVendorLocation] = useState("");
  const [activityLog, setActivityLog] = useState<string[]>([]);
  const [newCity, setNewCity] = useState("");
  const [newMinCost, setNewMinCost] = useState("");
  const [dirty, setDirty] = useState(false);

  const botQuery = useQuery({
    queryKey: ["savari-bot", queryVendorId],
    queryFn: () => api.getSavariBotConfig(queryVendorId),
  });

  useEffect(() => {
    if (!botQuery.data?.config || dirty) return;
    try {
      const ui = applySnapshot({
        config: botQuery.data.config as Record<string, unknown>,
        routes: (botQuery.data.routes || []) as Record<string, unknown>[],
      });
      setToggles(ui.toggles); setRoutesOut(ui.routesOut); setRoutesIn(ui.routesIn);
      setRoundTrip(ui.roundTrip); setRental(ui.rental); setBotConfig(ui.botConfig); setVendorLocation(ui.vendorLocation);
    } catch (e) {
      toast({ title: "Could not load bot config", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }, [botQuery.data, botQuery.dataUpdatedAt, dirty]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.putSavariBotConfig(buildSavariPutBody(vendorLocation, { toggles, routesOut, routesIn, roundTrip, rental, botConfig })),
    onSuccess: (res) => {
      if (!res.config) return;
      try {
        const ui = applySnapshot({ config: res.config as Record<string, unknown>, routes: (res.routes || []) as Record<string, unknown>[] });
        setToggles(ui.toggles); setRoutesOut(ui.routesOut); setRoutesIn(ui.routesIn);
        setRoundTrip(ui.roundTrip); setRental(ui.rental); setBotConfig(ui.botConfig); setVendorLocation(ui.vendorLocation);
        setQueryVendorId(ui.botConfig.vendorId); setDirty(false);
        queryClient.invalidateQueries({ queryKey: ["savari-bot"] });
        const ts = new Date().toLocaleTimeString("en-IN", { hour12: false });
        setActivityLog((prev) => [`[${ts}] Saved to server`, ...prev].slice(0, 50));
        toast({ title: "Saved", description: "Bot settings applied." });
      } catch (e) {
        toast({ title: "Save response error", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
      }
    },
    onError: (err) => toast({ title: "Save failed", description: err instanceof ApiError ? err.message : String(err), variant: "destructive" }),
  });

  const hasPollInterval = Number.isFinite(botConfig.pollingIntervalMs) && botConfig.pollingIntervalMs >= 5000;
  const cycleSec = hasPollInterval ? Math.max(30, Math.floor(botConfig.pollingIntervalMs / 1000)) : 0;

  useEffect(() => { if (cycleSec > 0) setNextRunSec(cycleSec); }, [cycleSec]);
  useEffect(() => {
    if (cycleSec <= 0) return;
    const t = window.setInterval(() => setNextRunSec((s) => (s <= 0 ? cycleSec : s - 1)), 1000);
    return () => window.clearInterval(t);
  }, [cycleSec]);

  const mm = Math.floor(nextRunSec / 60);
  const ss = nextRunSec % 60;
  const timerLabel = cycleSec <= 0 ? "—" : `${mm}:${ss.toString().padStart(2, "0")}`;
  const progressPct = cycleSec <= 0 ? 0 : Math.round(((cycleSec - nextRunSec) / cycleSec) * 100);

  const activeRoutes = direction === "kolkata_out" ? routesOut : routesIn;
  const setActiveRoutes = direction === "kolkata_out" ? setRoutesOut : setRoutesIn;

  const routesEnabledCount = useMemo(() => activeRoutes.filter((r) => r.enabled).length, [activeRoutes]);
  const activeCount = useMemo(() => Object.values(toggles).filter(Boolean).length, [toggles]);
  const routesActiveKpi = useMemo(() => countEnabledRoutes(routesOut, routesIn), [routesOut, routesIn]);

  const markDirty = () => setDirty(true);
  const removeRoute = (id: string) => { setActiveRoutes((l) => l.filter((r) => r.id !== id)); markDirty(); };
  const addRoute = () => {
    const city = newCity.trim();
    const cost = Number(newMinCost);
    if (!city || !Number.isFinite(cost) || cost <= 0) return;
    setActiveRoutes((l) => [...l, { id: `r-${Date.now()}`, city, minCost: cost, enabled: true }]);
    setNewCity(""); setNewMinCost(""); markDirty();
  };
  const saveToServer = () => saveMutation.mutate();
  const resetFromServer = async () => {
    setDirty(false);
    const res = await botQuery.refetch();
    if (res.data?.config) {
      try {
        const ui = applySnapshot({ config: res.data.config as Record<string, unknown>, routes: (res.data.routes || []) as Record<string, unknown>[] });
        setToggles(ui.toggles); setRoutesOut(ui.routesOut); setRoutesIn(ui.routesIn);
        setRoundTrip(ui.roundTrip); setRental(ui.rental); setBotConfig(ui.botConfig); setVendorLocation(ui.vendorLocation);
      } catch { /* toast in apply */ }
    }
  };
  const clearLog = () => setActivityLog([]);

  const footer = <ConfigFooter dirty={dirty} onReset={resetFromServer} onSave={saveToServer} saving={saveMutation.isPending} />;

  return (
    <div className={dark ? "mc dark" : "mc"} style={{ background: "var(--surface-page)", minHeight: "100vh" }}>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "20px 16px 40px", display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Status banners */}
        {botQuery.isLoading && <Banner tone="info">Loading bot config from API…</Banner>}
        {botQuery.isError && (
          <Banner tone="error">{botQuery.error instanceof ApiError ? botQuery.error.message : "Could not load config. Check VITE_API_BASE_URL and backend."}</Banner>
        )}
        {botQuery.data && !botQuery.data.config && !botQuery.isLoading && (
          <Banner tone="warn">No config row for vendor {queryVendorId}. Run seed_savari_bot.sql in Supabase.</Banner>
        )}

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <Link to="/savari" className="mc-btn mc-btn-ghost" style={{ width: 40, padding: 0, justifyContent: "center" }} aria-label="Back"><ArrowLeft size={18} /></Link>
            <Link to="/savari/analytics" className="mc-btn mc-btn-ghost" style={{ width: 40, padding: 0, justifyContent: "center" }} aria-label="Analytics"><BarChart3 size={16} /></Link>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <div style={{ width: 44, height: 44, borderRadius: 9999, background: "var(--surface-action)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                <TrendingUp size={20} color="#fff" />
              </div>
              <div>
                <h1 style={{ font: "800 18px/1.1 var(--font-heading)" }}>Savaari Booking Bot</h1>
                <p className="mc-num" style={{ font: "400 11px var(--font-body)", color: "var(--text-body-secondary)", marginTop: 2 }}>
                  Vendor {botConfig.vendorId || "—"} · {vendorLocation || "—"}
                </p>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <span className="mc-overline">Next run</span>
            <span className="mc-num" style={{ font: "700 15px var(--font-body)", color: "var(--text-heading)" }}>{timerLabel}</span>
            <div style={{ width: 112, height: 6, borderRadius: 9999, background: "var(--surface-table-header)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${progressPct}%`, background: "var(--blue-600)", borderRadius: 9999, transition: "width 300ms ease-out" }} />
            </div>
            <span className="mc-chip" style={{ background: running ? "var(--surface-success)" : "var(--surface-table-header)", color: running ? "var(--green-800)" : "var(--text-body-secondary)" }}>
              <span style={{ width: 6, height: 6, borderRadius: 9999, background: running ? "var(--green-600)" : "var(--grey-500)" }} />
              {running ? "Running" : "Stopped"}
            </span>
          </div>
        </div>

        {/* KPIs */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          <Kpi icon={<TrendingUp size={16} />} label="Bids today" value={0} hint="not stored yet" tone="var(--blue-600)" />
          <Kpi icon={<Scan size={16} />} label="Scanned" value={0} hint="not stored yet" tone="var(--teal-600)" />
          <Kpi icon={<Filter size={16} />} label="Filtered out" value={0} hint="not stored yet" tone="var(--yellow-600)" />
          <Kpi icon={<Route size={16} />} label="Routes active" value={routesActiveKpi} hint="both directions" tone="var(--purple-600)" />
        </div>

        {/* Trip toggles */}
        <div className="mc-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <h2 style={{ font: "700 15px var(--font-heading)" }}>Trip type toggles</h2>
            <span className="mc-chip" style={{ background: "var(--surface-success)", color: "var(--green-800)" }}>{activeCount} active</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {TRIP_LABELS.map(({ id, title, hint }) => (
              <div key={id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, borderRadius: 12, border: "1px solid var(--stroke-primary)", padding: "10px 14px" }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ font: "600 13px var(--font-heading)", color: "var(--text-heading)" }}>{title}</p>
                  <p style={{ font: "400 11px var(--font-body)", color: "var(--text-body-secondary)" }}>{hint}</p>
                </div>
                <Switch checked={toggles[id]} onCheckedChange={(v) => { setToggles((s) => ({ ...s, [id]: v })); markDirty(); }} className="data-[state=checked]:bg-[#1579be]" />
              </div>
            ))}
          </div>
        </div>

        {/* Config tabs */}
        <div className="mc-seg" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)" }}>
          {CONFIG_TABS.map((t) => (
            <button key={t.id} data-active={configTab === t.id} onClick={() => setConfigTab(t.id)}>{t.label}</button>
          ))}
        </div>

        {configTab === "routes" && (
          <div className="mc-card">
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8, marginBottom: 14 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <DirBtn active={direction === "kolkata_out"} onClick={() => setDirection("kolkata_out")}>→ Kolkata → Other city</DirBtn>
                <DirBtn active={direction === "into_kolkata"} onClick={() => setDirection("into_kolkata")}>← Other city → Kolkata</DirBtn>
              </div>
              <span className="mc-chip" style={{ background: "var(--surface-hover)", color: "var(--blue-800)", height: "fit-content" }}>{routesEnabledCount} active · {activeRoutes.length} total</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
              {activeRoutes.map((r) => (
                <div key={r.id} style={{ position: "relative", borderRadius: 12, border: "1px solid var(--stroke-primary)", padding: 12, opacity: r.enabled ? 1 : 0.55 }}>
                  <button onClick={() => removeRoute(r.id)} aria-label={`Remove ${r.city}`}
                    style={{ position: "absolute", right: 8, top: 8, border: "none", background: "transparent", color: "var(--text-body-secondary)", cursor: "pointer" }}>
                    <X size={14} />
                  </button>
                  <p style={{ font: "700 12px/1.2 var(--font-heading)", color: "var(--text-heading)", paddingRight: 20, marginBottom: 10 }}>{r.city}</p>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <span className="mc-overline">Active</span>
                    <Switch checked={r.enabled} className="scale-90 data-[state=checked]:bg-[#1579be]"
                      onCheckedChange={(v) => { setActiveRoutes((l) => l.map((x) => (x.id === r.id ? { ...x, enabled: v } : x))); markDirty(); }} />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", borderRadius: 10, border: "1px solid var(--stroke-primary)", padding: "2px 8px", background: "var(--surface-page)" }}>
                    <span className="mc-num" style={{ font: "500 12px var(--font-body)", color: "var(--text-body-secondary)" }}>₹</span>
                    <Input type="number" value={r.minCost} style={{ ...INPUT_STYLE, height: 28, border: "none", background: "transparent", padding: "0 4px" }}
                      onChange={(e) => { const v = Number(e.target.value); setActiveRoutes((l) => l.map((x) => (x.id === r.id ? { ...x, minCost: v } : x))); markDirty(); }} />
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16, borderTop: "1px solid var(--stroke-primary)", paddingTop: 16 }}>
              <Input placeholder="City name (e.g. Siliguri)" value={newCity} onChange={(e) => setNewCity(e.target.value)} style={{ ...INPUT_STYLE, flex: 1, minWidth: 160 }} />
              <Input type="number" placeholder="Min cost" value={newMinCost} onChange={(e) => setNewMinCost(e.target.value)} style={{ ...INPUT_STYLE, width: 120 }} />
              <button className="mc-btn mc-btn-primary" onClick={addRoute}>+ Add city</button>
            </div>
            {footer}
          </div>
        )}

        {configTab === "round" && (
          <div className="mc-card">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Min cost per km (₹)" value={roundTrip.minCostPerKm} onChange={(v) => { setRoundTrip((s) => ({ ...s, minCostPerKm: v })); markDirty(); }} />
              <Field label="Min cost per day (₹)" value={roundTrip.minCostPerDay} onChange={(v) => { setRoundTrip((s) => ({ ...s, minCostPerDay: v })); markDirty(); }} />
              <Field label="Mileage (km/l)" value={roundTrip.mileageKmPerL} onChange={(v) => { setRoundTrip((s) => ({ ...s, mileageKmPerL: v })); markDirty(); }} />
              <Field label="Fuel cost (₹/l)" value={roundTrip.fuelCostPerL} onChange={(v) => { setRoundTrip((s) => ({ ...s, fuelCostPerL: v })); markDirty(); }} />
            </div>
            <p className="mc-num" style={{ marginTop: 16, borderRadius: 12, border: "1px solid var(--stroke-primary)", background: "var(--surface-table-header)", padding: 12, font: "400 11px/1.7 var(--font-body)", color: "var(--text-body-secondary)" }}>
              A booking passes when: vendor_cost &gt; (days × min_per_day) + (kms / mileage × fuel_cost) and vendor_cost / kms &gt; min_per_km
            </p>
            {footer}
          </div>
        )}

        {configTab === "rental" && (
          <div className="mc-card">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
              <Field label="8hr / 80km — min cost (₹)" value={rental.min8h80km} onChange={(v) => { setRental((s) => ({ ...s, min8h80km: v })); markDirty(); }} />
              <Field label="4hr / 40km — min cost (₹)" value={rental.min4h40km} onChange={(v) => { setRental((s) => ({ ...s, min4h40km: v })); markDirty(); }} />
            </div>
            {footer}
          </div>
        )}

        {configTab === "config" && (
          <div className="mc-card">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Polling interval (ms)" value={botConfig.pollingIntervalMs} onChange={(v) => { setBotConfig((s) => ({ ...s, pollingIntervalMs: v })); markDirty(); }} />
              <TextField label="Vendor ID" value={botConfig.vendorId} onChange={(v) => { setBotConfig((s) => ({ ...s, vendorId: v })); markDirty(); }} />
            </div>
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
              <TextField label="Vendor location (pick city filter)" value={vendorLocation} onChange={(v) => { setVendorLocation(v); markDirty(); }} />
              <TextField label="API URL" value={botConfig.apiUrl} onChange={(v) => { setBotConfig((s) => ({ ...s, apiUrl: v })); markDirty(); }} />
              <TextField label="Car types (comma separated)" value={botConfig.carTypes} onChange={(v) => { setBotConfig((s) => ({ ...s, carTypes: v })); markDirty(); }} />
            </div>
            {footer}
          </div>
        )}

        {/* Activity log */}
        <div className="mc-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <h2 style={{ font: "700 15px var(--font-heading)" }}>Activity log</h2>
            <button className="mc-btn mc-btn-ghost" style={{ height: 30, fontSize: 12 }} onClick={clearLog}>Clear</button>
          </div>
          <div className="mc-num" style={{ maxHeight: 192, overflowY: "auto", borderRadius: 12, border: "1px solid var(--stroke-primary)", background: "var(--surface-table-header)", padding: 12, font: "400 11px/1.7 var(--font-body)", color: "var(--text-body)" }}>
            {activityLog.length === 0 ? <p style={{ color: "var(--text-body-secondary)" }}>No entries</p> : activityLog.map((line, i) => <p key={i}>{line}</p>)}
          </div>
        </div>

        <p style={{ textAlign: "center", font: "400 10px var(--font-body)", color: "var(--text-body-secondary)" }}>
          Settings load from GET /api/savari-bot/config · <Link to="/savari" style={{ color: "var(--blue-600)" }}>Back to broadcasts</Link>
        </p>
      </div>
    </div>
  );
}

function Banner({ tone, children }: { tone: "info" | "error" | "warn"; children: ReactNode }) {
  const map = {
    info: { bg: "var(--surface-hover)", color: "var(--blue-800)" },
    error: { bg: "var(--surface-error)", color: "var(--red-800)" },
    warn: { bg: "var(--surface-warning)", color: "var(--yellow-800)" },
  }[tone];
  return <p style={{ borderRadius: 12, padding: "8px 12px", font: "500 12px var(--font-body)", background: map.bg, color: map.color }}>{children}</p>;
}

function Kpi({ icon, label, value, hint, tone }: { icon: ReactNode; label: string; value: number; hint: string; tone: string }) {
  return (
    <div className="mc-card" style={{ padding: 14 }}>
      <div style={{ color: tone, marginBottom: 6 }}>{icon}</div>
      <p className="mc-overline">{label}</p>
      <p className="mc-num" style={{ font: "700 22px/1 var(--font-body)", color: "var(--text-heading)", marginTop: 4 }}>{value}</p>
      <p style={{ font: "400 10px var(--font-body)", color: "var(--text-body-secondary)", marginTop: 2 }}>{hint}</p>
    </div>
  );
}

function DirBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} style={{
      borderRadius: 9999, padding: "7px 14px", cursor: "pointer", font: "600 12px var(--font-heading)",
      border: `1px solid ${active ? "var(--blue-600)" : "var(--stroke-primary)"}`,
      background: active ? "var(--surface-hover)" : "transparent",
      color: active ? "var(--blue-800)" : "var(--text-body-secondary)", transition: "all 160ms ease-out",
    }}>{children}</button>
  );
}

function Field({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label style={{ display: "block" }}>
      <span className="mc-overline" style={{ display: "block", marginBottom: 6 }}>{label}</span>
      <Input type="number" value={Number.isFinite(value) ? String(value) : ""} onChange={(e) => onChange(Number(e.target.value))} style={INPUT_STYLE} />
    </label>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label style={{ display: "block" }}>
      <span className="mc-overline" style={{ display: "block", marginBottom: 6 }}>{label}</span>
      <Input value={value} onChange={(e) => onChange(e.target.value)} style={INPUT_STYLE} />
    </label>
  );
}

function ConfigFooter({ dirty, onReset, onSave, saving }: { dirty: boolean; onReset: () => void | Promise<void>; onSave: () => void; saving?: boolean }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 8, borderTop: "1px solid var(--stroke-primary)", marginTop: 16, paddingTop: 16 }}>
      <p style={{ font: "500 12px var(--font-body)", color: dirty ? "var(--yellow-600)" : "var(--text-body-secondary)" }}>{dirty ? "Unsaved changes" : "No unsaved changes"}</p>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="mc-btn mc-btn-ghost" onClick={() => void onReset()} disabled={saving}>Reset</button>
        <button className="mc-btn mc-btn-primary" onClick={onSave} disabled={saving}>{saving ? "Saving…" : "Save & apply"}</button>
      </div>
    </div>
  );
}
