// Analytics now lives in the main Supabase project (env-based, service-role),
// in the `savari_bookings` table. The old standalone project was retired.
const { supabase: analyticsSupabase } = require("./supabase");

const SAVARI_BOOKINGS_TABLE = "savari_bookings";

const TRIP_TYPE_MAP = {
  "Outstation (One way Drop)": "One Way Drop",
  "Outstation (Round Trip)": "Round Trip",
  "Local (8hr/80 km)": "Local 8hr",
  "Local (4hr/40 km)": "Local 4hr",
  "Local (12hr/120 km)": "Local 12hr",
  "Transfer (Drop To Airport)": "Transfer",
  "Transfer (Pick From Airport)": "Transfer",
  "Airport/railway transfer": "Transfer",
};

async function upsertBooking(b) {
  const totalAmt = Number(b.total_amt) || 0;
  const vendorCost = Number(b.vendor_cost) || 0;
  const savariCut = totalAmt - vendorCost;
  const savariCutPct = totalAmt > 0 ? Math.round((savariCut / totalAmt) * 10000) / 100 : 0;

  const row = {
    booking_id: String(b.booking_id),
    car_type: b.car_type || null,
    vendor_cost: Math.round(vendorCost),
    trip_type_name: TRIP_TYPE_MAP[b.trip_type_name] || "Other",
    total_amt: Math.round(totalAmt),
    start_date: b.start_date || null,
    pick_city: b.pick_city || null,
    pick_loc: b.pick_loc || null,
    payment_status: b.payment_status || null,
    savari_cut: Math.round(savariCut),
    savari_cut_pct: savariCutPct,
    updated_at: new Date().toISOString(),
  };

  const { error } = await analyticsSupabase
    .from(SAVARI_BOOKINGS_TABLE)
    .upsert(row, { onConflict: "booking_id" });

  if (error) console.error("[savari-analytics] upsert failed:", error.message);
}

module.exports = { upsertBooking, analyticsSupabase, SAVARI_BOOKINGS_TABLE };
