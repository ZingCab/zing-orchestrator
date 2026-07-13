import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, BarChart3, Bot, ChevronDown, ExternalLink, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/utils-date";
import {
  formatExpiresLabel,
  formatPickupDateTimeParts,
  formatSavariDateTime,
  googleMapsSearchUrl,
} from "@/lib/savariDisplay";
import {
  buildBookingGroups,
  computeGroupDebug,
  filterRowsByFleetCar,
  listAvgRpKm,
  parseBooking,
  sortParsedBookings,
  type ParsedBooking,
  type SavariSortKey,
} from "@/lib/savariBooking";
import { toast } from "@/hooks/use-toast";
import { LoadingSpinner, ErrorState, EmptyState } from "@/components/LoadingState";
import { SwipeToAccept } from "@/components/SwipeToAccept";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import "@/styles/metalcloud.css";

const ALL = "__all__";

const SORT_OPTIONS: { id: SavariSortKey; label: string }[] = [
  { id: "urgency", label: "Urgency" },
  { id: "earnings", label: "Earnings" },
  { id: "rpkm", label: "₹/km" },
  { id: "prepaidFirst", label: "Pre-paid" },
];

const CAR_CHIPS: { id: string; label: string }[] = [
  { id: ALL, label: "All" },
  { id: "etios", label: "Etios" },
  { id: "wagon", label: "Wagon R" },
];

function matchesCarChip(p: ParsedBooking, carId: string): boolean {
  if (carId === ALL) return true;
  const n = p.carType.toLowerCase();
  if (carId === "etios") return /\betios\b/i.test(p.carType) && !/crysta/i.test(n);
  if (carId === "wagon") return /wagon\s*r|wagonr/i.test(n) || (n.includes("wagon") && n.includes("r"));
  return true;
}

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

export default function SavariBroadcastsPage() {
  const dark = useDark();
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ["savaari", "broadcasts"],
    queryFn: () => api.getSavaariBroadcasts({ booking_id: "0" }),
  });

  const rawItems = q.data?.items ?? [];
  const rawCount = rawItems.length;

  const fleetRows = useMemo(() => filterRowsByFleetCar(rawItems as Record<string, unknown>[]), [rawItems]);
  const parsedAll = useMemo(() => fleetRows.map((row) => parseBooking(row)), [fleetRows]);

  const [sortKey, setSortKey] = useState<SavariSortKey>("urgency");
  const [carChip, setCarChip] = useState(ALL);
  const [paymentFilter, setPaymentFilter] = useState(ALL);
  const [tripTypeFilter, setTripTypeFilter] = useState(ALL);
  const [tab, setTab] = useState<"solo" | "groups">("solo");

  const { paymentOptions, tripTypeOptions } = useMemo(() => {
    const pays = new Set<string>();
    const trips = new Set<string>();
    for (const p of parsedAll) {
      if (p.paymentLabel) pays.add(p.paymentLabel);
      if (p.tripTypeName.trim()) trips.add(p.tripTypeName);
    }
    const sort = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });
    return { paymentOptions: [...pays].sort(sort), tripTypeOptions: [...trips].sort(sort) };
  }, [parsedAll]);

  const filtered = useMemo(() => {
    let list = parsedAll;
    list = list.filter((p) => matchesCarChip(p, carChip));
    if (paymentFilter !== ALL) list = list.filter((p) => p.paymentLabel === paymentFilter);
    if (tripTypeFilter !== ALL) list = list.filter((p) => p.tripTypeName === tripTypeFilter);
    return list;
  }, [parsedAll, carChip, paymentFilter, tripTypeFilter]);

  const sorted = useMemo(() => sortParsedBookings(filtered, sortKey), [filtered, sortKey]);

  const stats = useMemo(() => {
    const totalEarn = filtered.reduce((s, p) => s + p.vendorCost, 0);
    const prepaidN = filtered.filter((p) => p.isPrepaid).length;
    const avg = listAvgRpKm(filtered);
    return { totalEarn, prepaidN, avg };
  }, [filtered]);

  const groups = useMemo(() => buildBookingGroups(parsedAll), [parsedAll]);
  const groupDebug = useMemo(() => computeGroupDebug(rawCount, parsedAll), [rawCount, parsedAll]);

  const hasExtraFilters = carChip !== ALL || paymentFilter !== ALL || tripTypeFilter !== ALL;

  const openDetail = (p: ParsedBooking) =>
    navigate(`/savari/booking/${encodeURIComponent(p.bookingId)}`, { state: { row: p.row } });

  const onAccept = (p: ParsedBooking) =>
    toast({ title: "Accepted (local)", description: `Booking #${p.bookingId} — hook Savaari accept API when available.` });

  const ready = !q.isLoading && !q.isError && rawItems.length > 0;

  return (
    <div className={dark ? "mc dark" : "mc"} style={{ background: "var(--surface-page)", minHeight: "100vh" }}>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "20px 16px 40px", display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link to="/login" className="mc-btn mc-btn-ghost" style={{ width: 40, padding: 0, justifyContent: "center" }} aria-label="Back">
            <ArrowLeft size={18} />
          </Link>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span className="mc-overline">Savari · Live Feed</span>
            <h1 style={{ font: "800 20px/1.1 var(--font-heading)", marginTop: 2 }}>
              Open Bookings <span className="mc-num" style={{ color: "var(--blue-600)" }}>{parsedAll.length}</span>
            </h1>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <Link to="/savari/analytics" className="mc-btn mc-btn-ghost" style={{ height: 36, padding: "0 12px", fontSize: 12 }}>
              <BarChart3 size={14} /> Analytics
            </Link>
            <Link to="/savari/bot" className="mc-btn mc-btn-ghost" style={{ height: 36, padding: "0 12px", fontSize: 12 }}>
              <Bot size={14} /> Bot
            </Link>
            <button className="mc-btn mc-btn-ghost" style={{ width: 36, padding: 0, justifyContent: "center", height: 36 }}
              onClick={() => void q.refetch()} disabled={q.isFetching} aria-label="Refresh">
              <RefreshCw size={16} className={cn(q.isFetching && "animate-spin")} />
            </button>
          </div>
        </div>
        {rawCount > 0 && (
          <p style={{ font: "400 12px var(--font-body)", color: "var(--text-body-secondary)", marginTop: -8 }}>
            Feed {rawCount} · showing Etios &amp; Wagon R · rule-based
          </p>
        )}

        {ready && (
          <>
            {/* Stats strip */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
              <MiniStat label="Total earn" value={formatCurrency(stats.totalEarn)} tone="var(--blue-600)" />
              <MiniStat label="Pre-paid" value={`${stats.prepaidN}/${filtered.length}`} tone="var(--teal-600)" />
              <MiniStat label="Avg ₹/km" value={stats.avg.toFixed(1)} tone="var(--yellow-600)" />
            </div>

            {/* Sort */}
            <div>
              <p className="mc-overline" style={{ marginBottom: 8 }}>Sort</p>
              <div className="mc-seg" style={{ display: "flex", flexWrap: "wrap" }}>
                {SORT_OPTIONS.map((s) => (
                  <button key={s.id} data-active={sortKey === s.id} onClick={() => setSortKey(s.id)}>{s.label}</button>
                ))}
              </div>
            </div>

            {/* Car chips */}
            <div>
              <p className="mc-overline" style={{ marginBottom: 8 }}>Car (fleet)</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {CAR_CHIPS.map((c) => (
                  <button key={c.id} onClick={() => setCarChip(c.id)}
                    style={{
                      border: `1px solid ${carChip === c.id ? "var(--blue-600)" : "var(--stroke-primary)"}`,
                      background: carChip === c.id ? "var(--surface-action)" : "transparent",
                      color: carChip === c.id ? "var(--text-on-action)" : "var(--text-body)",
                      borderRadius: 9999, padding: "5px 14px", cursor: "pointer",
                      font: "600 12px var(--font-heading)", transition: "all 160ms ease-out",
                    }}>{c.label}</button>
                ))}
              </div>
            </div>

            {/* Selects */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <FilterSelect label="Payment" value={paymentFilter} options={paymentOptions} onChange={setPaymentFilter} />
              <FilterSelect label="Trip type" value={tripTypeFilter} options={tripTypeOptions} onChange={setTripTypeFilter} />
            </div>
            {hasExtraFilters && (
              <button className="mc-btn mc-btn-ghost" style={{ height: 32, alignSelf: "flex-start", fontSize: 12 }}
                onClick={() => { setCarChip(ALL); setPaymentFilter(ALL); setTripTypeFilter(ALL); }}>
                Clear filters
              </button>
            )}
          </>
        )}

        {q.isLoading && <LoadingSpinner label="Loading broadcasts…" />}
        {q.isError && <ErrorState message={q.error instanceof Error ? q.error.message : "Failed to load"} onRetry={() => void q.refetch()} />}
        {!q.isLoading && !q.isError && rawItems.length === 0 && (
          <EmptyState title="No broadcasts" subtitle="The feed returned no items, or the server token is not configured."
            icon={<RefreshCw className="mx-auto h-8 w-8 text-muted-foreground/40" />} />
        )}

        {ready && (
          <>
            {/* Tabs */}
            <div className="mc-seg" style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
              <button data-active={tab === "solo"} onClick={() => setTab("solo")}>Solo bookings</button>
              <button data-active={tab === "groups"} onClick={() => setTab("groups")}>Group bookings</button>
            </div>

            {tab === "solo" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {sorted.length === 0 && (
                  <EmptyState title="No matches" subtitle="Try changing or clearing filters."
                    icon={<RefreshCw className="mx-auto h-8 w-8 text-muted-foreground/40" />} />
                )}
                {sorted.map((p, i) => (
                  <BookingCard key={`${p.bookingId}-${i}`} p={p} onOpenDetail={() => openDetail(p)} onAccept={() => onAccept(p)} />
                ))}
              </div>
            )}

            {tab === "groups" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {groups.length === 0 ? (
                  <div className="mc-card" style={{ padding: 16 }}>
                    <p style={{ font: "700 14px var(--font-heading)", marginBottom: 6 }}>No route groups yet</p>
                    <p style={{ font: "400 12px var(--font-body)", color: "var(--text-body-secondary)", marginBottom: 12 }}>
                      Groups need two one-way bookings with both pickup &amp; drop cities, matching car, and pickup times
                      (reverse route within 5 days, or same corridor twice).
                    </p>
                    <div className="mc-num" style={{ borderRadius: 12, background: "var(--surface-table-header)", padding: 10, font: "500 10px/1.7 var(--font-body)", color: "var(--text-body-secondary)" }}>
                      <div>raw feed: {groupDebug.rawFeedCount}</div>
                      <div>after Etios/Wagon R: {groupDebug.fleetFilteredCount}</div>
                      <div>eligible (not round-trip): {groupDebug.eligibleForPairing}</div>
                      <div>with both cities: {groupDebug.withBothCities}</div>
                      <div>with pickup time parsed: {groupDebug.withPickupTime}</div>
                      <div>round-trip skipped: {groupDebug.roundTripSkipped}</div>
                    </div>
                  </div>
                ) : (
                  groups.map((g) => (
                    <div key={g.id} className="mc-card" style={{ padding: 16, borderLeft: "3px solid var(--blue-600)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
                        <div>
                          <p style={{ font: "700 14px var(--font-heading)", color: "var(--text-heading)" }}>{g.title}</p>
                          <p style={{ font: "400 11px var(--font-body)", color: "var(--text-body-secondary)" }}>{g.subtitle}</p>
                        </div>
                        <span className="mc-chip" style={{ background: "var(--surface-hover)", color: "var(--blue-800)", height: "fit-content" }}>
                          {g.kind === "return_pair" ? "Return pair" : "Repeat corridor"}
                        </span>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, borderTop: "1px solid var(--stroke-primary)", borderBottom: "1px solid var(--stroke-primary)", padding: "10px 0", textAlign: "center" }}>
                        <GroupStat label="Combined earn" value={formatCurrency(g.combinedEarn)} tone="var(--blue-600)" />
                        <GroupStat label={g.gapHours != null ? "Gap" : "Bookings"}
                          value={g.gapHours != null ? (g.gapHours < 48 ? `${g.gapHours.toFixed(1)}h` : `${(g.gapHours / 24).toFixed(1)}d`) : String(g.bookings.length)} />
                        <GroupStat label="Dead km est." value={g.deadKmSavedEstimate != null ? `~${Math.round(g.deadKmSavedEstimate)}` : "—"} />
                      </div>
                      <ol style={{ listStyle: "none", padding: 0, margin: "10px 0 0", display: "flex", flexDirection: "column", gap: 8 }}>
                        {g.bookings.map((b, idx) => (
                          <li key={b.bookingId} style={{ display: "flex", gap: 8, borderBottom: idx < g.bookings.length - 1 ? "1px solid var(--stroke-primary)" : "none", paddingBottom: 8 }}>
                            <span className="mc-num" style={{ width: 22, height: 22, flexShrink: 0, display: "grid", placeItems: "center", borderRadius: 9999, background: "var(--surface-table-header)", font: "600 10px var(--font-body)" }}>{idx + 1}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                                <span style={{ font: "600 12px var(--font-body)", color: "var(--text-body)" }}>{b.routeTitleShort}</span>
                                <span className="mc-num" style={{ font: "600 12px var(--font-body)", color: "var(--blue-600)" }}>{formatCurrency(b.vendorCost)}</span>
                              </div>
                              <p className="mc-num" style={{ font: "400 10px var(--font-body)", color: "var(--text-body-secondary)" }}>
                                {b.pickupTimeLabel || "—"} · {b.packageKms > 0 ? `${Math.round(b.packageKms)} km` : "—"} · #{b.bookingId}
                              </p>
                            </div>
                          </li>
                        ))}
                      </ol>
                      <p style={{ font: "400 11px/1.6 var(--font-body)", color: "var(--text-body-secondary)", marginTop: 10 }}>{g.insight}</p>
                      <button className="mc-btn mc-btn-ghost" style={{ height: 34, fontSize: 12, marginTop: 10 }} onClick={() => openDetail(g.bookings[0])}>
                        Open first booking →
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="mc-card" style={{ padding: "12px 14px" }}>
      <p className="mc-overline">{label}</p>
      <p className="mc-num" style={{ font: "700 16px var(--font-body)", color: tone, marginTop: 4 }}>{value}</p>
    </div>
  );
}

function GroupStat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <p style={{ font: "400 10px var(--font-body)", color: "var(--text-body-secondary)" }}>{label}</p>
      <p className="mc-num" style={{ font: "600 12px var(--font-body)", color: tone || "var(--text-heading)", marginTop: 2 }}>{value}</p>
    </div>
  );
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div>
      <p className="mc-overline" style={{ marginBottom: 6 }}>{label}</p>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9 text-xs" style={{ borderRadius: 12, fontFamily: "Oxanium" }}>
          <SelectValue placeholder="All" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All</SelectItem>
          {options.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function BookingCard({ p, onOpenDetail, onAccept }: { p: ParsedBooking; onOpenDetail: () => void; onAccept: () => void }) {
  const [open, setOpen] = useState(false);
  const timerColor = p.timerTone === "red" ? "var(--red-600)" : p.timerTone === "amber" ? "var(--yellow-600)" : "var(--green-600)";
  const scorePct = Math.min(100, Math.max(0, p.compositeScore));
  const addrLine = p.pickAddress || p.pickCity;
  const mapsUrl = addrLine ? googleMapsSearchUrl(addrLine) : "";
  const parts = formatPickupDateTimeParts(p.pickupTimeLabel);
  const kmStr = p.packageKms > 0 ? `${Math.round(p.packageKms)} km` : "—";

  return (
    <div className="mc-card" style={{ padding: 0, overflow: "hidden", borderLeft: p.borderAccent === "red" ? "3px solid var(--red-600)" : "3px solid transparent" }}>
      <div style={{ padding: "16px 16px 8px" }}>
        <span className="mc-num" style={{ font: "500 10px var(--font-body)", color: "var(--text-body-secondary)" }}>#{p.bookingId}</span>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 2 }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ font: "700 15px/1.3 var(--font-heading)", color: "var(--text-heading)" }}>{p.routeTitleShort}</p>
            <p style={{ font: "400 11px var(--font-body)", color: "var(--text-body-secondary)" }}>{p.carType}</p>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <p className="mc-num" style={{ font: "700 20px/1 var(--font-body)", color: "var(--blue-600)" }}>{formatCurrency(p.vendorCost)}</p>
            <p style={{ font: "400 10px var(--font-body)", color: "var(--text-body-secondary)" }}>your earnings</p>
            <p className="mc-num" style={{ font: "500 11px var(--font-body)", color: "var(--text-body)", marginTop: 2 }}>
              {formatCurrency(p.totalAmt)} <span style={{ color: "var(--text-body-secondary)" }}>total</span>
            </p>
            <div style={{ width: 96, marginTop: 4, marginLeft: "auto" }}>
              <div style={{ height: 6, borderRadius: 9999, background: "var(--surface-table-header)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${scorePct}%`, background: "var(--yellow-600)", borderRadius: 9999 }} />
              </div>
              <p className="mc-num" style={{ font: "400 10px var(--font-body)", color: "var(--text-body-secondary)" }}>{p.compositeScore}/100</p>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {p.isPrepaid && <span className="mc-chip" style={{ background: "var(--surface-success)", color: "var(--green-800)" }}>Pre Paid</span>}
          {p.tripTypeName && (
            <span className="mc-chip" style={{ background: "var(--surface-hover)", color: "var(--blue-800)" }}>
              {p.tripTypeName.length > 28 ? `${p.tripTypeName.slice(0, 28)}…` : p.tripTypeName}
            </span>
          )}
        </div>

        <button onClick={() => setOpen((v) => !v)}
          style={{ marginTop: 8, width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
            border: "1px dashed var(--stroke-primary)", background: "transparent", borderRadius: 12, padding: "6px 10px",
            font: "500 11px var(--font-body)", color: "var(--text-body-secondary)", cursor: "pointer" }}>
          <span>Rate &amp; step times</span>
          <ChevronDown size={16} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 160ms ease-out" }} />
        </button>
        {open && (
          <div style={{ marginTop: 8, borderRadius: 12, border: "1px solid var(--stroke-primary)", padding: "8px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
            <RowMini label="Rate change (step 1)" value={p.rateChangeStep1 || "—"} plain />
            <RowMini label="Step 1" value={p.step1At || "—"} />
            <RowMini label="Step 2" value={p.step2At || "—"} />
            <RowMini label="Step 3" value={p.step3At || "—"} />
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", borderTop: "1px solid var(--stroke-primary)", borderBottom: "1px solid var(--stroke-primary)", background: "var(--surface-table-header)", textAlign: "center" }}>
        <div style={{ padding: "10px 4px", borderRight: "1px solid var(--stroke-primary)" }}>
          <p style={{ font: "400 10px var(--font-body)", color: "var(--text-body-secondary)" }}>₹/km</p>
          <p className="mc-num" style={{ font: "700 14px var(--font-body)", color: p.rpKm < 8 ? "var(--yellow-600)" : "var(--text-heading)" }}>{p.packageKms > 0 ? p.rpKm.toFixed(1) : "—"}</p>
        </div>
        <div style={{ padding: "10px 4px", borderRight: "1px solid var(--stroke-primary)" }}>
          <p style={{ font: "400 10px var(--font-body)", color: "var(--text-body-secondary)" }}>Collect</p>
          <p className="mc-num" style={{ font: "700 14px var(--font-body)", color: "var(--text-heading)" }}>{p.cashToCollect > 0 ? formatCurrency(p.cashToCollect) : "—"}</p>
        </div>
        <div style={{ padding: "8px 4px", background: "var(--surface-hover)" }}>
          <p className="mc-overline" style={{ color: "var(--blue-800)" }}>Pickup trip</p>
          <p className="mc-num" style={{ font: "700 12px/1.3 var(--font-body)", color: "var(--blue-800)" }}>{parts.dateStr}</p>
          <p className="mc-num" style={{ font: "700 12px/1.3 var(--font-body)", color: "var(--blue-800)" }}>{parts.timeStr}</p>
          <p className="mc-num" style={{ font: "700 12px/1.3 var(--font-body)", color: "var(--blue-800)" }}>{kmStr}</p>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 16px", borderBottom: "1px solid var(--stroke-primary)" }}>
        <span style={{ font: "500 12px var(--font-body)", color: "var(--text-body-secondary)" }}>Expires</span>
        <span className="mc-num" style={{ font: "700 12px var(--font-body)", color: timerColor }}>{formatExpiresLabel(p.hoursLeft)}</span>
      </div>

      <div style={{ display: "flex", gap: 8, padding: 12, alignItems: "center" }}>
        <div style={{ flex: 1, minWidth: 0 }}><SwipeToAccept onAccept={onAccept} /></div>
        <button className="mc-btn mc-btn-primary" style={{ width: 48, height: 48, padding: 0, justifyContent: "center", borderRadius: 14 }}
          aria-label="Booking detail" onClick={onOpenDetail}>
          <ArrowRight size={20} />
        </button>
      </div>

      {addrLine && (
        <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
          style={{ display: "flex", gap: 8, borderTop: "1px solid var(--stroke-primary)", background: "var(--surface-table-header)", padding: "10px 14px", font: "400 11px/1.5 var(--font-body)", color: "var(--text-body)", textDecoration: "none" }}>
          <ExternalLink size={14} style={{ marginTop: 2, flexShrink: 0, color: "var(--blue-600)" }} />
          <span><span style={{ fontWeight: 600, color: "var(--text-heading)" }}>Pickup address · </span>{addrLine}</span>
        </a>
      )}
    </div>
  );
}

function RowMini({ label, value, plain }: { label: string; value: string; plain?: boolean }) {
  const text = plain ? value : formatSavariDateTime(value);
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
      <span style={{ font: "400 11px var(--font-body)", color: "var(--text-body-secondary)" }}>{label}</span>
      <span className="mc-num" style={{ font: "500 10px var(--font-body)", color: "var(--text-body)", textAlign: "right" }}>{text}</span>
    </div>
  );
}
