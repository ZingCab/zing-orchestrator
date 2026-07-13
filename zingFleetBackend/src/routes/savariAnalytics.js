const router = require("express").Router();
const { analyticsSupabase, SAVARI_BOOKINGS_TABLE } = require("../lib/savariAnalytics");

// Cache the computed payload briefly so repeated page loads don't re-query the
// whole bookings table each time (reduces egress against the analytics DB).
const CACHE_TTL_MS = 60000;
let cache = { at: 0, payload: null };

router.get("/dashboard", async (_req, res, next) => {
  try {
    if (cache.payload && Date.now() - cache.at < CACHE_TTL_MS) {
      return res.json({ success: true, data: cache.payload });
    }

    // Fail fast instead of hanging ~30s when the analytics DB is unreachable.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    let bookings = [];
    let error = null;
    try {
      // PostgREST caps each response at 1000 rows (max-rows), which .range()
      // can't override — so page through until a short page signals the end.
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data: page, error: pageErr } = await analyticsSupabase
          .from(SAVARI_BOOKINGS_TABLE)
          .select("*")
          .order("created_at", { ascending: false })
          .range(from, from + PAGE - 1)
          .abortSignal(controller.signal);
        if (pageErr) {
          error = pageErr;
          break;
        }
        bookings.push(...(page || []));
        if (!page || page.length < PAGE) break;
      }
    } finally {
      clearTimeout(timeout);
    }

    if (error) {
      // Timeout / connectivity failure to the analytics Supabase project.
      const msg = String(error.message || "");
      if (
        controller.signal.aborted ||
        error.name === "AbortError" ||
        /timed out|522|fetch failed|ECONNREFUSED|ENOTFOUND/i.test(msg)
      ) {
        return res.status(503).json({
          success: false,
          error: "Analytics database is unavailable. The Supabase project may be paused or down.",
        });
      }
      throw error;
    }

    const rows = bookings || [];
    const now = new Date();
    const currentYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const sum = (arr, k) => arr.reduce((s, r) => s + Number(r[k] || 0), 0);
    const avg = (arr, k) => (arr.length ? sum(arr, k) / arr.length : 0);

    // ── Headline totals (exact, all-time — no misleading MoM %) ─────────────
    const summary = {
      totalTrips: rows.length,
      totalEarned: sum(rows, "vendor_cost"),
      avgPayout: Math.round(avg(rows, "vendor_cost")),
      avgSavariCutPct: Number(avg(rows, "savari_cut_pct").toFixed(1)),
    };

    // ── Generic grouper → sorted array with count + payout economics ────────
    const groupBy = (keyFn) => {
      const m = new Map();
      for (const r of rows) {
        const key = keyFn(r);
        if (!key) continue;
        if (!m.has(key)) m.set(key, { trips: 0, payout: 0, cutPctSum: 0 });
        const g = m.get(key);
        g.trips += 1;
        g.payout += Number(r.vendor_cost || 0);
        g.cutPctSum += Number(r.savari_cut_pct || 0);
      }
      return [...m.entries()]
        .map(([key, g]) => ({
          key,
          trips: g.trips,
          payout: Math.round(g.payout),
          avgPayout: Math.round(g.payout / g.trips),
          avgCutPct: Number((g.cutPctSum / g.trips).toFixed(1)),
        }))
        .sort((a, b) => b.trips - a.trips);
    };

    const byTripType = groupBy((r) => r.trip_type_name || "Other");
    const byCarType = groupBy((r) => r.car_type || "Unknown");
    const byCity = groupBy((r) => r.pick_city || "Unknown").slice(0, 12);
    const byPayment = groupBy((r) => r.payment_status || "Unknown").map((g) => ({
      status: g.key,
      trips: g.trips,
      payout: g.payout,
    }));

    // ── car_type × trip_type demand matrix (counts) ─────────────────────────
    const matrix = {};
    for (const r of rows) {
      const car = r.car_type || "Unknown";
      const trip = r.trip_type_name || "Other";
      if (!matrix[car]) matrix[car] = {};
      matrix[car][trip] = (matrix[car][trip] || 0) + 1;
    }

    // ── Monthly time series, keyed by TRIP date (start_date) — this is what an
    // operator plans around. Months at/after the current one are flagged
    // `partial` (still filling: current month in progress + future bookings
    // trickling in) so the UI can render them lighter and never read as a drop.
    const monthlyMap = new Map();
    for (const r of rows) {
      const ym = (r.start_date || r.created_at || "").slice(0, 7);
      if (!ym) continue;
      if (!monthlyMap.has(ym)) monthlyMap.set(ym, { trips: 0, earned: 0, byType: {} });
      const g = monthlyMap.get(ym);
      const trip = r.trip_type_name || "Other";
      g.trips += 1;
      g.earned += Number(r.vendor_cost || 0);
      g.byType[trip] = (g.byType[trip] || 0) + 1;
    }
    const monthlySeries = [...monthlyMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ym, g]) => ({
        ym,
        trips: g.trips,
        earned: Math.round(g.earned),
        byType: g.byType,
        partial: ym >= currentYm,
      }));

    // Trip-type keys present, most common first — for stable chart series/legends.
    const tripTypes = byTripType.map((t) => t.key);

    const createdDates = rows.map((r) => r.created_at).filter(Boolean).sort();
    const dateRange = {
      first: createdDates[0] || null,
      last: createdDates[createdDates.length - 1] || null,
    };

    const recent = rows.slice(0, 50);

    const payload = {
      summary,
      matrix,
      monthlySeries,
      tripTypes,
      byTripType,
      byCarType,
      byCity,
      byPayment,
      dateRange,
      recent,
    };
    cache = { at: Date.now(), payload };
    res.json({ success: true, data: payload });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
