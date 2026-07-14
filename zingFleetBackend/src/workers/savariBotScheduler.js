/**
 * Polls getNewBusiness + loads rules from Supabase. Logs matches only — NO postInterest / bid.
 *
 * Same process as API: SAVARI_BOT_SCHEDULER=1 npm start
 * Standalone:        npm run scheduler:savari
 */

require("dotenv").config();
const { supabase } = require("../lib/supabase");
const {
  fetchSavaariNewBusiness,
  fetchSavaariUpcomingBookings,
  postSavaariPostInterest,
} = require("../lib/savaariVendor");
const { upsertBooking } = require("../lib/savariAnalytics");
const { sendNtfy, pingHealthcheckOk, pingHealthcheckFail } = require("../lib/notify");

const LOG = "[savari-bot-scheduler]";

const vendorId = (process.env.SAVARI_BOT_VENDOR_ID || "175236").trim();
const biddingEnabled =
  process.env.SAVARI_BOT_BID_ENABLED === "1" ||
  process.env.SAVARI_BOT_BID_ENABLED === "true";

const processedBookings = new Set();

// ── Alerting state ──────────────────────────────────────────────────────
// Consecutive failed/empty ticks before we suspect the vendorToken has
// rotated/expired (Savaari gives no explicit "invalid token" flag we can key
// off, so this proxy is what we have — same signature as the outage we hit).
const TOKEN_ALERT_AFTER_TICKS = 5; // ~5 poll cycles of feed trouble
let consecutiveFetchFailures = 0;
let consecutiveEmptyFeeds = 0;
let tokenAlertSent = false;

// Dispatch reminders (getUpcomingBookings) — polled far less often than the
// broadcast feed since trip schedules don't change minute to minute.
const UPCOMING_CHECK_INTERVAL_MS = 15 * 60 * 1000;
const DISPATCH_ALERT_WINDOW_HOURS = 2;
let lastUpcomingCheckAt = 0;
const dispatchAlerted = new Set();

// Tracks the last-upserted signature per booking so we only write to the
// analytics DB when a booking is new or its relevant fields actually changed.
// The same broadcast bookings sit in the feed for hours; without this we would
// re-upsert every row on every poll tick (a write storm that burns quota).
const upsertedSignatures = new Map();
const UPSERT_CACHE_MAX = 5000;

function upsertSignature(b) {
  return [
    b.car_type,
    b.vendor_cost,
    b.trip_type_name,
    b.total_amt,
    b.start_date,
    b.pick_city,
    b.pick_loc,
    b.payment_status,
  ].join("|");
}

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function safeJson(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function parseCarTypes(csv) {
  if (!csv || typeof csv !== "string") return [];
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function routeMapsFromRows(rows) {
  const out = {};
  const inn = {};
  for (const r of rows || []) {
    if (!r.enabled) continue;
    const city = String(r.city || "").trim();
    if (!city) continue;
    const min = num(r.min_cost_inr, 0);
    if (r.direction === "kolkata_out") out[city] = min;
    if (r.direction === "into_kolkata") inn[city] = min;
  }
  return { out, inn };
}

function extractDestination(booking) {
  const itinerary2 = booking.itinerary2 || "";
  const itinerary = booking.itinerary || "";
  if (itinerary2) return String(itinerary2).trim();
  if (itinerary.includes("→") || itinerary.includes("&rarr;")) {
    const parts = String(itinerary).split(/→|&rarr;/);
    return parts[1] ? parts[1].trim() : "";
  }
  return "";
}

function carAllowed(booking, carTypes) {
  const ct = booking.car_type;
  if (!carTypes.length) return true;
  return carTypes.includes(ct);
}

function cityAllowed(booking, cities) {
  if (!cities.length) return true;
  return cities.includes(booking.pick_city);
}

function normalizeText(v) {
  return String(v || "").trim().toLowerCase();
}

function includesNormalized(haystack, needle) {
  return normalizeText(haystack).includes(normalizeText(needle));
}

function isKolkataLike(v) {
  return includesNormalized(v, "kolkata") || includesNormalized(v, "calcutta");
}

function checkRental(booking, rental) {
  if (booking.trip_type !== "Local usage") return false;
  const vendorCost = num(booking.vendor_cost, 0);
  if (booking.trip_type_name === "Local (8hr/80 km)") {
    return vendorCost >= num(rental.min8h80km, 0);
  }
  if (booking.trip_type_name === "Local (4hr/40 km)") {
    return vendorCost >= num(rental.min4h40km, 0);
  }
  return false;
}

function checkOutstation(booking, routesOut, routesIn, baseCity) {
  if (booking.trip_type !== "Outstation usage") return false;
  if (booking.trip_type_name === "Outstation (Round Trip)") return false;

  const pick = booking.pick_city || "";
  const dest = extractDestination(booking);
  const vendorCost = num(booking.vendor_cost, 0);

  const fromKolkata =
    !!baseCity && (normalizeText(pick) === normalizeText(baseCity) || isKolkataLike(pick));
  const toKolkata = isKolkataLike(dest);

  if (fromKolkata) {
    for (const [routeCity, minCost] of Object.entries(routesOut)) {
      if (includesNormalized(dest, routeCity) && vendorCost >= minCost) return true;
    }
  }

  for (const [routeCity, minCost] of Object.entries(routesIn)) {
    if (includesNormalized(pick, routeCity) && toKolkata && vendorCost >= minCost) {
      return true;
    }
  }

  return false;
}

function checkRoundTrip(booking, round) {
  if (booking.trip_type_name !== "Outstation (Round Trip)") return false;
  const vendorCost = num(booking.vendor_cost, 0);
  const packageKms = num(booking.package_kms, 0);
  const numDays = num(booking.num_days, 1);
  if (packageKms <= 0) return false;

  const minPerKm = num(round.minCostPerKm, 0);
  const minPerDay = num(round.minCostPerDay, 0);
  const mileage = num(round.mileageKmPerL, 1) || 1;
  const fuelPerL = num(round.fuelCostPerL, 0);

  const costPerKm = vendorCost / packageKms;
  if (costPerKm <= minPerKm) return false;

  const fuelCost = (packageKms / mileage) * fuelPerL;
  const operatingCost = numDays * minPerDay + fuelCost;
  return vendorCost > operatingCost;
}

function checkTransfer(booking) {
  return booking.trip_type === "Airport/railway transfer";
}

function shouldBook(booking, cfg, routesOut, routesIn, carTypes, cities, baseCity) {
  const tripType = booking.trip_type;
  const tripTypeName = booking.trip_type_name;

  const enabled = {
    rental: cfg.trip_local_rental,
    outstation: cfg.trip_outstation_oneway,
    roundTrip: cfg.trip_outstation_round,
    transfer: cfg.trip_airport_transfer,
  };

  const rental = {
    min8h80km: num(cfg.rental_min_8h_80km, 0),
    min4h40km: num(cfg.rental_min_4h_40km, 0),
  };

  const round = {
    minCostPerKm: num(cfg.round_min_cost_per_km, 0),
    minCostPerDay: num(cfg.round_min_cost_per_day, 0),
    mileageKmPerL: num(cfg.round_mileage_km_per_l, 0),
    fuelCostPerL: num(cfg.round_fuel_cost_per_l, 0),
  };

  let checkFn = null;
  if (tripType === "Local usage" && enabled.rental) {
    checkFn = () => checkRental(booking, rental);
  } else if (tripTypeName === "Outstation (Round Trip)" && enabled.roundTrip) {
    checkFn = () => checkRoundTrip(booking, round);
  } else if (tripType === "Outstation usage" && enabled.outstation) {
    checkFn = () => checkOutstation(booking, routesOut, routesIn, baseCity);
  } else if (tripType === "Airport/railway transfer" && enabled.transfer) {
    checkFn = () => checkTransfer(booking);
  } else {
    return false;
  }

  if (carTypes.length && !carAllowed(booking, carTypes)) return false;

  // Outstation has its own directional city checks (Kolkata -> X and X -> Kolkata),
  // so don't block it with a generic pick_city == vendor_location condition.
  if (tripType !== "Outstation usage" && cities.length && !cityAllowed(booking, cities)) {
    return false;
  }

  return checkFn();
}

async function loadRules() {
  const { data: config, error: e1 } = await supabase
    .from("savari_bot_config")
    .select("*")
    .eq("vendor_id", vendorId)
    .maybeSingle();
  if (e1) throw e1;

  const { data: routeRows, error: e2 } = await supabase
    .from("savari_bot_routes")
    .select("*")
    .eq("vendor_id", vendorId);
  if (e2) throw e2;

  return { config, routeRows: routeRows || [] };
}

// Fires once when the feed has been empty or erroring for several ticks in a
// row — the same symptom we saw when the vendorToken went stale. Not a
// definitive "token expired" signal (Savaari doesn't give us one), but a
// reliable proxy worth checking. Resets (and sends a recovery note) once the
// feed is healthy again — see the reset next to consecutiveEmptyFeeds = 0.
function checkTokenHealth(ts) {
  const trouble = Math.max(consecutiveFetchFailures, consecutiveEmptyFeeds);
  if (trouble >= TOKEN_ALERT_AFTER_TICKS && !tokenAlertSent) {
    tokenAlertSent = true;
    console.warn(LOG, ts, "[token health] feed trouble threshold hit", { trouble });
    sendNtfy({
      title: "🔑 Savari feed may need attention",
      message: `${trouble} poll cycles with no bookings / errors. The vendorToken may have expired — check Bot → Config, or verify balance/KYC.`,
      priority: "urgent",
      tags: ["key", "rotating_light"],
    });
  }
}

// Checks confirmed/won trips for ones reporting soon with no driver assigned
// yet, and pushes one alert per booking (deduped in-memory; resets on
// restart, which just means a possible repeat alert, never a missed one).
async function checkDispatchReminders(ts) {
  try {
    const json = await fetchSavaariUpcomingBookings();
    const rs = json.resultset || json.resultSet || {};
    const upcoming = Array.isArray(rs.UpcomingBookings) ? rs.UpcomingBookings : [];

    for (const b of upcoming) {
      const bookingId = String(b.booking_id || "");
      if (!bookingId || dispatchAlerted.has(bookingId)) continue;

      const hourDiff = Number(b.hour_diff);
      const hasDriver = !!(b.driver_details && String(b.driver_details).trim());
      if (hasDriver || !Number.isFinite(hourDiff) || hourDiff > DISPATCH_ALERT_WINDOW_HOURS || hourDiff < 0) {
        continue;
      }

      dispatchAlerted.add(bookingId);
      const route = b.iten || b.trip_itinerary || `${b.pick_city || ""}`;
      const reportTime = b.reporting_time || b.trip_start_date_time || "soon";
      sendNtfy({
        title: "🚗 Dispatch needed",
        message: `#${bookingId} ${route} reports ${reportTime} — no driver assigned yet.`,
        priority: "high",
        tags: ["car", "warning"],
      });
      console.log(LOG, ts, "[dispatch reminder]", { booking_id: bookingId, reporting_time: reportTime });
    }
  } catch (e) {
    console.error(LOG, ts, "[upcoming bookings check failed]", e?.message || e);
  }
}

async function tick() {
  const ts = new Date().toISOString();
  try {
    if (Date.now() - lastUpcomingCheckAt >= UPCOMING_CHECK_INTERVAL_MS) {
      lastUpcomingCheckAt = Date.now();
      await checkDispatchReminders(ts);
    }

    const { config, routeRows } = await loadRules();
    if (!config) {
      console.warn(LOG, ts, "no savari_bot_config for vendor_id=", vendorId);
      return;
    }

    const carTypes = parseCarTypes(config.car_types_csv);
    const cities = config.vendor_location ? [String(config.vendor_location).trim()] : [];
    const baseCity = config.vendor_location || "Kolkata, West Bengal";
    const { out: routesOut, inn: routesIn } = routeMapsFromRows(routeRows);

    const enabledRoutes = (routeRows || []).filter((r) => r && r.enabled);
    console.log(LOG, ts, "[rules] Supabase loaded", {
      vendor_id: vendorId,
      polling_interval_ms: config.polling_interval_ms,
      vendor_location: config.vendor_location || null,
      api_url: config.api_url || null,
      car_types_csv: config.car_types_csv || null,
      trips: {
        trip_local_rental: !!config.trip_local_rental,
        trip_outstation_oneway: !!config.trip_outstation_oneway,
        trip_outstation_round: !!config.trip_outstation_round,
        trip_airport_transfer: !!config.trip_airport_transfer,
      },
      routes_total: (routeRows || []).length,
      routes_enabled: enabledRoutes.length,
      rules_baseCity: baseCity,
    });

    const json = await fetchSavaariNewBusiness("0");
    consecutiveFetchFailures = 0; // the call itself succeeded (HTTP-level)

    const rs = json.resultset || json.resultSet || {};
    const broadcastDetails = Array.isArray(rs.broadcast_details)
      ? rs.broadcast_details
      : [];

    if (!broadcastDetails.length) {
      consecutiveEmptyFeeds += 1;
      console.log(LOG, ts, "poll ok, 0 bookings", { consecutive_empty: consecutiveEmptyFeeds });
      checkTokenHealth(ts);
      await pingHealthcheckOk();
      return;
    }
    consecutiveEmptyFeeds = 0;
    if (tokenAlertSent) {
      tokenAlertSent = false;
      sendNtfy({
        title: "✅ Savari feed recovered",
        message: "Bookings are flowing again — no action needed.",
        priority: "default",
        tags: ["white_check_mark"],
      });
    }

    console.log(LOG, ts, `poll ok, ${broadcastDetails.length} booking(s) in feed`);

    for (const booking of broadcastDetails) {
      if (!booking.booking_id) continue;
      const id = String(booking.booking_id);
      const sig = upsertSignature(booking);
      // Skip rows we've already written unchanged — avoids re-upserting the
      // same feed bookings every tick.
      if (upsertedSignatures.get(id) === sig) continue;
      if (upsertedSignatures.size >= UPSERT_CACHE_MAX) upsertedSignatures.clear();
      upsertedSignatures.set(id, sig);
      upsertBooking(booking).catch((e) => {
        // Roll back the marker so a failed write is retried next tick.
        upsertedSignatures.delete(id);
        console.error(LOG, "[analytics upsert error]", e?.message || e);
      });
    }

    let eligibleCount = 0;
    for (const booking of broadcastDetails) {
      const bookingId = String(booking.booking_id ?? "");
      if (!bookingId || processedBookings.has(bookingId)) continue;

      if (
        shouldBook(booking, config, routesOut, routesIn, carTypes, cities, baseCity)
      ) {
        processedBookings.add(bookingId);
        eligibleCount += 1;

        const vendorCost = num(booking.vendor_cost, 0);
        const broadcastId = String(
          booking.broadcast_id ?? booking.broadcastId ?? ""
        ).trim();

        console.log(LOG, ts, "[ELIGIBLE]", {
          booking_id: bookingId,
          vendor_cost: vendorCost,
          broadcast_id: broadcastId || null,
          pick_city: booking.pick_city || null,
          car_type: booking.car_type || null,
          trip_type: booking.trip_type || null,
          trip_type_name: booking.trip_type_name || null,
        });

        if (!biddingEnabled) {
          console.log(LOG, ts, "[BID skipped]", {
            reason: "SAVARI_BOT_BID_ENABLED is false",
          });
          continue;
        }

        console.log(LOG, ts, "[BID attempt]", {
          booking_id: bookingId,
          vendor_cost: vendorCost,
          broadcast_id: broadcastId || null,
        });

        try {
          const bidJson = await postSavaariPostInterest({
            vendorId,
            bookingId,
            vendorCost,
            broadcastId: broadcastId || undefined,
          });
          console.log(LOG, ts, "[BID success]", {
            booking_id: bookingId,
            response_keys:
              bidJson && typeof bidJson === "object" ? Object.keys(bidJson) : [],
            response_json: safeJson(bidJson),
          });
          sendNtfy({
            title: "🎉 Bid placed",
            message: `#${bookingId} · ₹${vendorCost} · ${booking.pick_city || ""} · ${booking.trip_type_name || booking.trip_type || ""}`,
            priority: "high",
            tags: ["tada", "moneybag"],
          });
        } catch (err) {
          console.error(LOG, ts, "[BID error]", {
            booking_id: bookingId,
            message: err?.message || String(err),
            upstream_status: err?.status || null,
            upstream_json: safeJson(err?.upstream ?? null),
          });
          sendNtfy({
            title: "⚠️ Bid failed",
            message: `#${bookingId} · ₹${vendorCost} · ${err?.message || "unknown error"}`,
            priority: "high",
            tags: ["warning"],
          });
        }
      }
    }

    console.log(LOG, ts, "[tick done]", {
      vendor_id: vendorId,
      feed_count: broadcastDetails.length,
      eligible_count: eligibleCount,
      processed_bookings_size: processedBookings.size,
    });
    await pingHealthcheckOk();
  } catch (err) {
    console.error(LOG, ts, "tick error:", err.message || err);
    consecutiveFetchFailures += 1;
    checkTokenHealth(ts);
    await pingHealthcheckFail();
  }
}

function start() {
  (async () => {
    let intervalMs = Number(process.env.SAVARI_BOT_INTERVAL_MS) || 120000;
    try {
      const { config } = await loadRules();
      if (config?.polling_interval_ms != null) {
        const p = num(config.polling_interval_ms, intervalMs);
        if (p >= 5000) intervalMs = p;
      }
    } catch (e) {
      console.warn(LOG, "initial loadRules failed:", e.message || e);
    }

    console.log(
      LOG,
      "started vendor_id=",
      vendorId,
      "interval_ms=",
      intervalMs,
      "biddingEnabled=" + (biddingEnabled ? "true" : "false"),
    );

    await tick();
    setInterval(tick, intervalMs);
  })().catch((e) => console.error(LOG, e));
}

if (require.main === module) {
  start();
}

module.exports = { start, tick };
