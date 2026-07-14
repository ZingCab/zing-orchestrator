import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Route, X, Car, Timer, Layers } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api, ApiError } from "@/lib/api";
import { toast } from "@/hooks/use-toast";
import { applySnapshot, buildSavariPutBody, countEnabledRoutes } from "@/lib/savariBotMapping";
import type { OutstationRoute, RouteDirection, TripToggleId } from "@/data/savariBotDummy";
import { SavariShell } from "@/components/SavariShell";

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

export default function SavariBotDashboard() {
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
  const [tokenInput, setTokenInput] = useState("");
  const [savingToken, setSavingToken] = useState(false);

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
      setTokenInput(String((botQuery.data.config as any).savaariVendorToken || ""));
    } catch (e) {
      toast({ title: "Could not load bot config", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }, [botQuery.data, botQuery.dataUpdatedAt, dirty]);

  const saveToken = async () => {
    setSavingToken(true);
    try {
      await api.putSavariBotToken(queryVendorId, tokenInput.trim());
      const ts = new Date().toLocaleTimeString("en-IN", { hour12: false });
      setActivityLog((prev) => [`[${ts}] Savaari token updated`, ...prev].slice(0, 50));
      toast({ title: "Token saved", description: "Feed will use the new token within ~1 min." });
    } catch (e) {
      toast({ title: "Token save failed", description: e instanceof ApiError ? e.message : String(e), variant: "destructive" });
    } finally {
      setSavingToken(false);
    }
  };

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
  const carsCount = botConfig.carTypes.split(",").map((s) => s.trim()).filter(Boolean).length;

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

  const actions = (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ textAlign: "right" }}>
        <div className="mc-overline">Next run</div>
        <div className="mc-num" style={{ font: "700 14px var(--font-body)", color: "var(--text-heading)" }}>{timerLabel}</div>
      </div>
      <span className="mc-chip" style={{ background: running ? "var(--chip-success-bg)" : "var(--surface-table-header)", color: running ? "var(--chip-success-fg)" : "var(--text-body-secondary)" }}>
        <span style={{ width: 6, height: 6, borderRadius: 9999, background: running ? "var(--green-600)" : "var(--grey-500)" }} />
        {running ? "Running" : "Stopped"}
      </span>
    </div>
  );

  return (
    <SavariShell active="bot" title="Booking Bot" subtitle={`Vendor ${botConfig.vendorId || "—"} · ${vendorLocation || "—"}`} actions={actions}>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Status banners */}
        {botQuery.isLoading && <Banner tone="info">Loading bot config from API…</Banner>}
        {botQuery.isError && (
          <Banner tone="error">{botQuery.error instanceof ApiError ? botQuery.error.message : "Could not load config. Check VITE_API_BASE_URL and backend."}</Banner>
        )}
        {botQuery.data && !botQuery.data.config && !botQuery.isLoading && (
          <Banner tone="warn">No config row for vendor {queryVendorId}. Run seed_savari_bot.sql in Supabase.</Banner>
        )}

        {/* Status hero */}
        <div className="mc-card" style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span style={{ width: 9, height: 9, borderRadius: 9999, background: running ? "var(--green-600)" : "var(--grey-500)", boxShadow: running ? "0 0 0 4px rgba(43,162,76,.18)" : "none" }} />
              <h2 style={{ font: "800 19px/1 var(--font-heading)", color: "var(--text-heading)" }}>{running ? "Bot is running" : "Bot is paused"}</h2>
            </div>
            <p style={{ font: "400 13px/1.6 var(--font-body)", color: "var(--text-body-secondary)", marginTop: 8 }}>
              {cycleSec > 0 ? <>Polling every <b style={{ color: "var(--text-body)" }}>{cycleSec}s</b></> : "Polling paused"} · watching{" "}
              <b style={{ color: "var(--text-body)" }}>{routesActiveKpi}</b> routes · <b style={{ color: "var(--text-body)" }}>{activeCount}/4</b> trip types enabled.
            </p>
            <p style={{ font: "400 11px var(--font-body)", color: "var(--text-body-secondary)", marginTop: 4 }}>
              Matches are logged to the activity feed below.
            </p>
          </div>
          <ProgressRing pct={progressPct} label={timerLabel} sublabel="next run" />
        </div>

        {/* Config-derived KPIs (real, not placeholders) */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          <Kpi icon={<Layers size={16} />} label="Trip types on" value={`${activeCount}/4`} hint="enabled for bidding" tone="var(--blue-600)" />
          <Kpi icon={<Route size={16} />} label="Routes active" value={routesActiveKpi} hint="both directions" tone="var(--purple-600)" />
          <Kpi icon={<Timer size={16} />} label="Poll interval" value={cycleSec > 0 ? `${cycleSec}s` : "—"} hint="feed scan cadence" tone="var(--teal-600)" />
          <Kpi icon={<Car size={16} />} label="Fleet car types" value={carsCount} hint="from config" tone="var(--yellow-600)" />
        </div>

        {/* Trip toggles */}
        <div className="mc-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <h2 style={{ font: "700 15px var(--font-heading)" }}>Trip type toggles</h2>
            <span className="mc-chip" style={{ background: "var(--chip-success-bg)", color: "var(--chip-success-fg)" }}>{activeCount} active</span>
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
              <span className="mc-chip" style={{ background: "var(--chip-info-bg)", color: "var(--chip-info-fg)", height: "fit-content" }}>{routesEnabledCount} active · {activeRoutes.length} total</span>
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

            {/* Savaari vendor token — separate save (rotating credential) */}
            <div style={{ marginTop: 16, borderTop: "1px solid var(--stroke-primary)", paddingTop: 16 }}>
              <label style={{ display: "block" }}>
                <span className="mc-overline" style={{ display: "block", marginBottom: 6 }}>Savaari vendor token</span>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Input type="password" placeholder="Paste current vendorToken from vendor.savaari.com"
                    value={tokenInput} onChange={(e) => setTokenInput(e.target.value)}
                    style={{ ...INPUT_STYLE, flex: 1, minWidth: 200 }} />
                  <button className="mc-btn mc-btn-primary" onClick={saveToken} disabled={savingToken}>
                    {savingToken ? "Saving…" : "Update token"}
                  </button>
                </div>
              </label>
              <p style={{ font: "400 11px/1.6 var(--font-body)", color: "var(--text-body-secondary)", marginTop: 8 }}>
                Rotating credential — if the feed goes empty, copy the current vendorToken from a logged-in Savaari
                session and update it here. No redeploy needed; the feed picks it up within ~1 min.
              </p>
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
      </div>
    </SavariShell>
  );
}

function Banner({ tone, children }: { tone: "info" | "error" | "warn"; children: ReactNode }) {
  const map = {
    info: { bg: "var(--chip-info-bg)", color: "var(--chip-info-fg)" },
    error: { bg: "var(--chip-error-bg)", color: "var(--chip-error-fg)" },
    warn: { bg: "var(--chip-warn-bg)", color: "var(--chip-warn-fg)" },
  }[tone];
  return <p style={{ borderRadius: 12, padding: "8px 12px", font: "500 12px var(--font-body)", background: map.bg, color: map.color }}>{children}</p>;
}

function Kpi({ icon, label, value, hint, tone }: { icon: ReactNode; label: string; value: string | number; hint: string; tone: string }) {
  return (
    <div className="mc-card" style={{ padding: 14 }}>
      <div style={{ color: tone, marginBottom: 6 }}>{icon}</div>
      <p className="mc-overline">{label}</p>
      <p className="mc-num" style={{ font: "700 22px/1 var(--font-body)", color: "var(--text-heading)", marginTop: 4 }}>{value}</p>
      <p style={{ font: "400 10px var(--font-body)", color: "var(--text-body-secondary)", marginTop: 2 }}>{hint}</p>
    </div>
  );
}

function ProgressRing({ pct, label, sublabel }: { pct: number; label: string; sublabel: string }) {
  const size = 92, stroke = 7, r = (size - stroke) / 2, circ = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-table-header)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--blue-600)" strokeWidth={stroke}
          strokeDasharray={circ} strokeDashoffset={circ * (1 - clamped / 100)} strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 300ms ease-out" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>
        <div>
          <div className="mc-num" style={{ font: "700 17px/1 var(--font-body)", color: "var(--text-heading)" }}>{label}</div>
          <div className="mc-overline" style={{ marginTop: 3 }}>{sublabel}</div>
        </div>
      </div>
    </div>
  );
}

function DirBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} style={{
      borderRadius: 9999, padding: "7px 14px", cursor: "pointer", font: "600 12px var(--font-heading)",
      border: `1px solid ${active ? "var(--blue-600)" : "var(--stroke-primary)"}`,
      background: active ? "var(--chip-info-bg)" : "transparent",
      color: active ? "var(--chip-info-fg)" : "var(--text-body-secondary)", transition: "all 160ms ease-out",
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
