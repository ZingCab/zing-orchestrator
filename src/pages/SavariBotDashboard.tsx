import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  BarChart3,
  ChevronDown,
  TrendingUp,
  Scan,
  Filter,
  Route,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { api, ApiError } from "@/lib/api";
import { toast } from "@/hooks/use-toast";
import {
  applySnapshot,
  buildSavariPutBody,
  countEnabledRoutes,
} from "@/lib/savariBotMapping";
import type { OutstationRoute, RouteDirection, TripToggleId } from "@/data/savariBotDummy";

const DEFAULT_VENDOR_ID = import.meta.env.VITE_SAVARI_VENDOR_ID || "262882";

const TRIP_LABELS: { id: TripToggleId; title: string; hint: string }[] = [
  { id: "outstation_oneway", title: "Outstation — one way", hint: "City-to-city single direction trips" },
  { id: "outstation_round", title: "Outstation — round trip", hint: "Multi-day return journeys" },
  { id: "local_rental", title: "Local rental", hint: "4hr/40km or 8hr/80km packages" },
  { id: "airport_transfer", title: "Airport / railway transfer", hint: "Point-to-point transfers" },
];

export default function SavariBotDashboard() {
  const queryClient = useQueryClient();
  const [queryVendorId, setQueryVendorId] = useState(DEFAULT_VENDOR_ID);

  const [nextRunSec, setNextRunSec] = useState(120);
  const [running] = useState(true);
  const [toggles, setToggles] = useState<Record<TripToggleId, boolean>>({
    outstation_oneway: false,
    outstation_round: false,
    local_rental: false,
    airport_transfer: false,
  });
  const [direction, setDirection] = useState<RouteDirection>("into_kolkata");
  const [routesOut, setRoutesOut] = useState<OutstationRoute[]>([]);
  const [routesIn, setRoutesIn] = useState<OutstationRoute[]>([]);
  const [roundTrip, setRoundTrip] = useState({
    minCostPerKm: 0,
    minCostPerDay: 0,
    mileageKmPerL: 0,
    fuelCostPerL: 0,
  });
  const [rental, setRental] = useState({ min8h80km: 0, min4h40km: 0 });
  const [botConfig, setBotConfig] = useState({
    pollingIntervalMs: 0,
    vendorId: "",
    apiUrl: "",
    carTypes: "",
  });
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
      setToggles(ui.toggles);
      setRoutesOut(ui.routesOut);
      setRoutesIn(ui.routesIn);
      setRoundTrip(ui.roundTrip);
      setRental(ui.rental);
      setBotConfig(ui.botConfig);
      setVendorLocation(ui.vendorLocation);
    } catch (e) {
      toast({
        title: "Could not load bot config",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }, [botQuery.data, botQuery.dataUpdatedAt, dirty]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.putSavariBotConfig(
        buildSavariPutBody(vendorLocation, {
          toggles,
          routesOut,
          routesIn,
          roundTrip,
          rental,
          botConfig,
        }),
      ),
    onSuccess: (res) => {
      if (!res.config) return;
      try {
        const ui = applySnapshot({
          config: res.config as Record<string, unknown>,
          routes: (res.routes || []) as Record<string, unknown>[],
        });
        setToggles(ui.toggles);
        setRoutesOut(ui.routesOut);
        setRoutesIn(ui.routesIn);
        setRoundTrip(ui.roundTrip);
        setRental(ui.rental);
        setBotConfig(ui.botConfig);
        setVendorLocation(ui.vendorLocation);
        setQueryVendorId(ui.botConfig.vendorId);
        setDirty(false);
        queryClient.invalidateQueries({ queryKey: ["savari-bot"] });
        const ts = new Date().toLocaleTimeString("en-IN", { hour12: false });
        setActivityLog((prev) => [`[${ts}] Saved to server`, ...prev].slice(0, 50));
        toast({ title: "Saved", description: "Bot settings applied." });
      } catch (e) {
        toast({
          title: "Save response error",
          description: e instanceof Error ? e.message : String(e),
          variant: "destructive",
        });
      }
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : String(err);
      toast({ title: "Save failed", description: msg, variant: "destructive" });
    },
  });

  const hasPollInterval =
    Number.isFinite(botConfig.pollingIntervalMs) && botConfig.pollingIntervalMs >= 5000;
  const cycleSec = hasPollInterval
    ? Math.max(30, Math.floor(botConfig.pollingIntervalMs / 1000))
    : 0;

  useEffect(() => {
    if (cycleSec > 0) setNextRunSec(cycleSec);
  }, [cycleSec]);

  useEffect(() => {
    if (cycleSec <= 0) return;
    const t = window.setInterval(() => {
      setNextRunSec((s) => (s <= 0 ? cycleSec : s - 1));
    }, 1000);
    return () => window.clearInterval(t);
  }, [cycleSec]);

  const mm = Math.floor(nextRunSec / 60);
  const ss = nextRunSec % 60;
  const timerLabel = cycleSec <= 0 ? "—" : `${mm}:${ss.toString().padStart(2, "0")}`;
  const progressPct =
    cycleSec <= 0 ? 0 : Math.round(((cycleSec - nextRunSec) / cycleSec) * 100);

  const activeRoutes = direction === "kolkata_out" ? routesOut : routesIn;
  const setActiveRoutes = direction === "kolkata_out" ? setRoutesOut : setRoutesIn;

  const routesEnabledCount = useMemo(
    () => activeRoutes.filter((r) => r.enabled).length,
    [activeRoutes],
  );

  const activeCount = useMemo(
    () => Object.values(toggles).filter(Boolean).length,
    [toggles],
  );

  const routesActiveKpi = useMemo(
    () => countEnabledRoutes(routesOut, routesIn),
    [routesOut, routesIn],
  );

  const markDirty = () => setDirty(true);

  const removeRoute = (id: string) => {
    setActiveRoutes((list) => list.filter((r) => r.id !== id));
    markDirty();
  };

  const addRoute = () => {
    const city = newCity.trim();
    const cost = Number(newMinCost);
    if (!city || !Number.isFinite(cost) || cost <= 0) return;
    setActiveRoutes((list) => [
      ...list,
      { id: `r-${Date.now()}`, city, minCost: cost, enabled: true },
    ]);
    setNewCity("");
    setNewMinCost("");
    markDirty();
  };

  const saveToServer = () => {
    saveMutation.mutate();
  };

  const resetFromServer = async () => {
    setDirty(false);
    const res = await botQuery.refetch();
    if (res.data?.config) {
      try {
        const ui = applySnapshot({
          config: res.data.config as Record<string, unknown>,
          routes: (res.data.routes || []) as Record<string, unknown>[],
        });
        setToggles(ui.toggles);
        setRoutesOut(ui.routesOut);
        setRoutesIn(ui.routesIn);
        setRoundTrip(ui.roundTrip);
        setRental(ui.rental);
        setBotConfig(ui.botConfig);
        setVendorLocation(ui.vendorLocation);
      } catch {
        /* toast in apply */
      }
    }
  };

  const clearLog = () => setActivityLog([]);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <div className="mx-auto max-w-2xl px-4 pb-8 pt-4">
        {botQuery.isLoading && (
          <p className="mb-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-600">
            Loading bot config from API…
          </p>
        )}
        {botQuery.isError && (
          <p className="mb-3 rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-xs text-red-300">
            {botQuery.error instanceof ApiError
              ? botQuery.error.message
              : "Could not load config. Check VITE_API_BASE_URL and backend."}
          </p>
        )}
        {botQuery.data && !botQuery.data.config && !botQuery.isLoading && (
          <p className="mb-3 rounded-lg border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
            No config row for vendor <code className="text-amber-100">{queryVendorId}</code>. Run{" "}
            <code className="text-amber-100">seed_savari_bot.sql</code> in Supabase.
          </p>
        )}
        {/* Header */}
        <div className="mb-6 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
              asChild
            >
              <Link to="/savari" aria-label="Back">
                <ArrowLeft className="h-5 w-5" />
              </Link>
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="shrink-0"
              asChild
            >
              <Link to="/savari/analytics" aria-label="Analytics">
                <BarChart3 className="h-4 w-4" />
              </Link>
            </Button>
            <div className="flex gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-600">
                <TrendingUp className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-semibold leading-tight">Savaari Booking Bot</h1>
                <p className="text-xs text-zinc-600">
                  Vendor ID: {botConfig.vendorId} · {vendorLocation}
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <div className="space-y-1 text-right">
              <p className="text-[10px] uppercase tracking-wide text-zinc-500">Next run</p>
              <p className="font-mono text-sm font-semibold tabular-nums text-zinc-900">{timerLabel}</p>
              <div className="h-1.5 w-28 overflow-hidden rounded-full bg-zinc-200">
                <div
                  className="h-full rounded-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-medium",
                running ? "bg-emerald-500/15 text-emerald-700" : "bg-zinc-200 text-zinc-600",
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", running ? "bg-emerald-600" : "bg-zinc-400")} />
              {running ? "Running" : "Stopped"}
            </span>
          </div>
        </div>

        {/* KPIs */}
        <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Kpi icon={<TrendingUp className="h-4 w-4" />} label="Bids today" value={0} hint="not stored yet" accent="emerald" />
          <Kpi icon={<Scan className="h-4 w-4" />} label="Scanned" value={0} hint="not stored yet" accent="sky" />
          <Kpi icon={<Filter className="h-4 w-4" />} label="Filtered out" value={0} hint="not stored yet" accent="amber" />
          <Kpi icon={<Route className="h-4 w-4" />} label="Routes active" value={routesActiveKpi} hint="across both directions" accent="violet" />
        </div>

        {/* Trip toggles */}
        <div className="mb-5 rounded-2xl border border-zinc-200 bg-white shadow-sm shadow-zinc-200/60 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Trip type toggles</h2>
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
              {activeCount} active
            </span>
          </div>
          <ul className="space-y-3">
            {TRIP_LABELS.map(({ id, title, hint }) => (
              <li
                key={id}
                className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200/80 bg-zinc-50 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{title}</p>
                  <p className="text-[11px] text-zinc-500">{hint}</p>
                </div>
                <Switch
                  checked={toggles[id]}
                  onCheckedChange={(v) => {
                    setToggles((s) => ({ ...s, [id]: v }));
                    markDirty();
                  }}
                  className="data-[state=checked]:bg-emerald-600"
                />
              </li>
            ))}
          </ul>
        </div>

        {/* Tabs + config */}
        <Tabs defaultValue="routes" className="space-y-4">
          <TabsList className="grid w-full grid-cols-4 bg-zinc-100 p-1">
            <TabsTrigger value="routes" className="text-[11px] data-[state=active]:bg-white data-[state=active]:shadow-sm">
              Outstation
            </TabsTrigger>
            <TabsTrigger value="round" className="text-[11px] data-[state=active]:bg-white data-[state=active]:shadow-sm">
              Round trip
            </TabsTrigger>
            <TabsTrigger value="rental" className="text-[11px] data-[state=active]:bg-white data-[state=active]:shadow-sm">
              Rental
            </TabsTrigger>
            <TabsTrigger value="config" className="text-[11px] data-[state=active]:bg-white data-[state=active]:shadow-sm">
              Config
            </TabsTrigger>
          </TabsList>

          <TabsContent value="routes" className="mt-0 space-y-3">
            <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm shadow-zinc-200/60 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-1 flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setDirection("kolkata_out")}
                    className={cn(
                      "rounded-full border px-3 py-2 text-xs font-medium transition-colors",
                      direction === "kolkata_out"
                        ? "border-blue-600 bg-blue-50 text-blue-800"
                        : "border-zinc-300 bg-white text-zinc-500",
                    )}
                  >
                    → Kolkata → Other city
                  </button>
                  <button
                    type="button"
                    onClick={() => setDirection("into_kolkata")}
                    className={cn(
                      "rounded-full border px-3 py-2 text-xs font-medium transition-colors",
                      direction === "into_kolkata"
                        ? "border-blue-600 bg-blue-50 text-blue-800"
                        : "border-zinc-300 bg-white text-zinc-500",
                    )}
                  >
                    ← Other city → Kolkata
                  </button>
                </div>
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-800">
                  {routesEnabledCount} active · {activeRoutes.length} total
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 sm:grid-cols-3">
                {activeRoutes.map((r) => (
                  <div
                    key={r.id}
                    className={cn(
                      "relative rounded-xl border bg-zinc-50 p-2.5 transition-opacity",
                      r.enabled ? "border-zinc-200" : "border-zinc-300 opacity-60",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => removeRoute(r.id)}
                      className="absolute right-1.5 top-1.5 z-10 rounded text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
                      aria-label={`Remove ${r.city}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                    <div className="mb-2 flex items-start justify-between gap-1 pr-6">
                      <p className="text-xs font-semibold leading-tight text-zinc-900">{r.city}</p>
                    </div>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                        Active
                      </span>
                      <Switch
                        checked={r.enabled}
                        onCheckedChange={(v) => {
                          setActiveRoutes((list) =>
                            list.map((x) => (x.id === r.id ? { ...x, enabled: v } : x)),
                          );
                          markDirty();
                        }}
                        className="scale-90 data-[state=checked]:bg-emerald-600"
                        aria-label={`${r.enabled ? "Disable" : "Enable"} route ${r.city}`}
                      />
                    </div>
                    <div className="flex items-center rounded-lg border border-zinc-200 bg-white px-2 py-1.5">
                      <span className="text-xs text-zinc-500">₹</span>
                      <Input
                        type="number"
                        value={r.minCost}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setActiveRoutes((list) =>
                            list.map((x) => (x.id === r.id ? { ...x, minCost: v } : x)),
                          );
                          markDirty();
                        }}
                        className="h-7 border-0 bg-transparent px-1 text-xs text-zinc-900 focus-visible:ring-0"
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap gap-2 border-t border-zinc-200 pt-4">
                <Input
                  placeholder="City name (e.g. Siliguri)"
                  value={newCity}
                  onChange={(e) => setNewCity(e.target.value)}
                  className="border-zinc-200 bg-white text-sm text-zinc-900 placeholder:text-zinc-400"
                />
                <Input
                  type="number"
                  placeholder="Min cost"
                  value={newMinCost}
                  onChange={(e) => setNewMinCost(e.target.value)}
                  className="w-28 border-zinc-200 bg-white text-sm text-zinc-900 placeholder:text-zinc-400"
                />
                <Button type="button" variant="secondary" className="bg-zinc-200 text-zinc-900 hover:bg-zinc-300" onClick={addRoute}>
                  + Add city
                </Button>
              </div>

              <ConfigFooter
                dirty={dirty}
                onReset={resetFromServer}
                onSave={saveToServer}
                saving={saveMutation.isPending}
              />
            </div>
          </TabsContent>

          <TabsContent value="round" className="mt-0">
            <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm shadow-zinc-200/60 p-4">
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Min cost per km (₹)"
                  value={roundTrip.minCostPerKm}
                  onChange={(v) => {
                    setRoundTrip((s) => ({ ...s, minCostPerKm: v }));
                    markDirty();
                  }}
                />
                <Field
                  label="Min cost per day (₹)"
                  value={roundTrip.minCostPerDay}
                  onChange={(v) => {
                    setRoundTrip((s) => ({ ...s, minCostPerDay: v }));
                    markDirty();
                  }}
                />
                <Field
                  label="Mileage (km/l)"
                  value={roundTrip.mileageKmPerL}
                  onChange={(v) => {
                    setRoundTrip((s) => ({ ...s, mileageKmPerL: v }));
                    markDirty();
                  }}
                />
                <Field
                  label="Fuel cost (₹/l)"
                  value={roundTrip.fuelCostPerL}
                  onChange={(v) => {
                    setRoundTrip((s) => ({ ...s, fuelCostPerL: v }));
                    markDirty();
                  }}
                />
              </div>
              <p className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3 font-mono text-[11px] leading-relaxed text-zinc-400">
                A booking passes when:{" "}
                <span className="text-zinc-400">
                  vendor_cost &gt; (days × min_per_day) + (kms / mileage × fuel_cost)
                </span>{" "}
                and{" "}
                <span className="text-zinc-400">vendor_cost / kms &gt; min_per_km</span>
              </p>
              <ConfigFooter
                dirty={dirty}
                onReset={resetFromServer}
                onSave={saveToServer}
                saving={saveMutation.isPending}
              />
            </div>
          </TabsContent>

          <TabsContent value="rental" className="mt-0">
            <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm shadow-zinc-200/60 p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field
                  label="8hr / 80km — min cost (₹)"
                  value={rental.min8h80km}
                  onChange={(v) => {
                    setRental((s) => ({ ...s, min8h80km: v }));
                    markDirty();
                  }}
                />
                <Field
                  label="4hr / 40km — min cost (₹)"
                  value={rental.min4h40km}
                  onChange={(v) => {
                    setRental((s) => ({ ...s, min4h40km: v }));
                    markDirty();
                  }}
                />
              </div>
              <ConfigFooter
                dirty={dirty}
                onReset={resetFromServer}
                onSave={saveToServer}
                saving={saveMutation.isPending}
              />
            </div>
          </TabsContent>

          <TabsContent value="config" className="mt-0">
            <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm shadow-zinc-200/60 p-4">
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Polling interval (ms)"
                  value={botConfig.pollingIntervalMs}
                  onChange={(v) => {
                    setBotConfig((s) => ({ ...s, pollingIntervalMs: v }));
                    markDirty();
                  }}
                />
                <label className="block">
                  <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                    Vendor ID
                  </span>
                  <Input
                    value={botConfig.vendorId}
                    onChange={(e) => {
                      setBotConfig((s) => ({ ...s, vendorId: e.target.value }));
                      markDirty();
                    }}
                    className="border-zinc-200 bg-white text-sm text-zinc-900"
                  />
                </label>
              </div>
              <label className="mt-3 block">
                <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                  Vendor location (pick city filter)
                </span>
                <Input
                  value={vendorLocation}
                  onChange={(e) => {
                    setVendorLocation(e.target.value);
                    markDirty();
                  }}
                  className="border-zinc-200 bg-white text-sm text-zinc-900"
                />
              </label>
              <label className="mt-3 block">
                <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                  API URL
                </span>
                <Input
                  value={botConfig.apiUrl}
                  onChange={(e) => {
                    setBotConfig((s) => ({ ...s, apiUrl: e.target.value }));
                    markDirty();
                  }}
                  className="border-zinc-200 bg-white text-sm text-zinc-900"
                />
              </label>
              <label className="mt-3 block">
                <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                  Car types (comma separated)
                </span>
                <Input
                  value={botConfig.carTypes}
                  onChange={(e) => {
                    setBotConfig((s) => ({ ...s, carTypes: e.target.value }));
                    markDirty();
                  }}
                  className="border-zinc-200 bg-white text-sm text-zinc-900"
                />
              </label>
              <ConfigFooter
                dirty={dirty}
                onReset={resetFromServer}
                onSave={saveToServer}
                saving={saveMutation.isPending}
              />
            </div>
          </TabsContent>
        </Tabs>

        {/* Activity log */}
        <div className="mt-6 rounded-2xl border border-zinc-200 bg-white shadow-sm shadow-zinc-200/60 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Activity log</h2>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
              onClick={clearLog}
            >
              Clear
            </Button>
          </div>
          <div className="relative max-h-48 overflow-y-auto rounded-xl border border-zinc-200 bg-zinc-100 p-3 font-mono text-[11px] leading-relaxed text-zinc-700">
            {activityLog.length === 0 ? (
              <p className="text-zinc-600">No entries</p>
            ) : (
              activityLog.map((line, i) => (
                <p key={i} className="text-zinc-700">
                  {line}
                </p>
              ))
            )}
            <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 text-zinc-400">
              <ChevronDown className="h-4 w-4" />
            </div>
          </div>
        </div>

        <p className="mt-6 text-center text-[10px] text-zinc-500">
          Settings load from <code className="text-zinc-500">GET /api/savari-bot/config</code> · Set{" "}
          <code className="text-zinc-500">VITE_API_BASE_URL</code> if the API is not on the default host.{" "}
          <Link to="/savari" className="text-blue-500 underline-offset-2 hover:underline">
            Back to broadcasts
          </Link>
        </p>
      </div>
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  hint,
  accent,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  hint: string;
  accent: "emerald" | "sky" | "amber" | "violet";
}) {
  const ring =
    accent === "emerald"
      ? "border-emerald-500/20 bg-emerald-500/5"
      : accent === "sky"
        ? "border-sky-500/20 bg-sky-500/5"
        : accent === "amber"
          ? "border-amber-500/20 bg-amber-500/5"
          : "border-violet-500/20 bg-violet-500/5";
  const ic =
    accent === "emerald"
      ? "text-emerald-600"
      : accent === "sky"
        ? "text-sky-600"
        : accent === "amber"
          ? "text-amber-600"
          : "text-violet-600";
  return (
    <div className={cn("rounded-xl border p-3", ring)}>
      <div className={cn("mb-1 flex items-center gap-1.5", ic)}>{icon}</div>
      <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="text-xl font-bold tabular-nums text-zinc-900">{value}</p>
      <p className="text-[10px] text-zinc-600">{hint}</p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      <Input
        type="number"
        value={numberOrZero(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="border-zinc-200 bg-white text-sm text-zinc-900"
      />
    </label>
  );
}

function numberOrZero(n: number): string {
  return Number.isFinite(n) ? String(n) : "";
}

function ConfigFooter({
  dirty,
  onReset,
  onSave,
  saving,
}: {
  dirty: boolean;
  onReset: () => void | Promise<void>;
  onSave: () => void;
  saving?: boolean;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 pt-4">
      <p className="text-xs text-zinc-500">{dirty ? "Unsaved changes" : "No unsaved changes"}</p>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          className="border-zinc-300 bg-transparent text-zinc-700"
          onClick={() => void onReset()}
          disabled={saving}
        >
          Reset
        </Button>
        <Button
          type="button"
          className="bg-zinc-200 text-zinc-900 hover:bg-white"
          onClick={onSave}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save & apply"}
        </Button>
      </div>
    </div>
  );
}
