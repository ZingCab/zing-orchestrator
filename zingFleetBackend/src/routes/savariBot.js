const router = require("express").Router();
const { z } = require("zod");
const { supabase } = require("../lib/supabase");
const { validate } = require("../middleware/validate");
const { AppError } = require("../middleware/errorHandler");

const routeRow = z.object({
  direction: z.enum(["kolkata_out", "into_kolkata"]),
  city: z.string().min(1).max(120),
  min_cost_inr: z.number().nonnegative(),
  enabled: z.boolean().optional().default(true),
  sort_order: z.number().int().optional().default(0),
});

const putSchema = z.object({
  config: z.object({
    vendor_id: z.string().min(1),
    vendor_location: z.string().optional().nullable(),
    polling_interval_ms: z.number().int().min(5000).max(86400000).optional(),
    api_url: z.union([z.string().url(), z.literal("")]).optional().nullable(),
    car_types_csv: z.string().optional().nullable(),
    trip_outstation_oneway: z.boolean().optional(),
    trip_outstation_round: z.boolean().optional(),
    trip_local_rental: z.boolean().optional(),
    trip_airport_transfer: z.boolean().optional(),
    round_min_cost_per_km: z.number().nonnegative().optional().nullable(),
    round_min_cost_per_day: z.number().nonnegative().optional().nullable(),
    round_mileage_km_per_l: z.number().nonnegative().optional().nullable(),
    round_fuel_cost_per_l: z.number().nonnegative().optional().nullable(),
    rental_min_8h_80km: z.number().nonnegative().optional().nullable(),
    rental_min_4h_40km: z.number().nonnegative().optional().nullable(),
  }),
  routes: z.array(routeRow),
});

router.get("/config", async (req, res, next) => {
  try {
    const vendorId = req.query.vendor_id != null ? String(req.query.vendor_id).trim() : "";
    if (!vendorId) throw new AppError("vendor_id query param is required", 400);

    console.log("[savari-bot] GET /config vendor_id=", vendorId);

    const { data: config, error: e1 } = await supabase
      .from("savari_bot_config")
      .select("*")
      .eq("vendor_id", vendorId)
      .maybeSingle();
    if (e1) throw new AppError(e1.message, 500);

    const { data: routes, error: e2 } = await supabase
      .from("savari_bot_routes")
      .select("*")
      .eq("vendor_id", vendorId)
      .order("direction")
      .order("sort_order")
      .order("city");
    if (e2) throw new AppError(e2.message, 500);

    res.json({ success: true, data: { config: config ?? null, routes: routes ?? [] } });
  } catch (err) {
    next(err);
  }
});

router.put("/config", validate(putSchema), async (req, res, next) => {
  try {
    const { config, routes } = req.body;
    console.log(
      "[savari-bot] PUT /config vendor_id=",
      config?.vendor_id,
      "routes=",
      Array.isArray(routes) ? routes.length : 0,
    );

    const { error } = await supabase.rpc("savari_bot_apply_save", {
      p_config: config,
      p_routes: routes,
    });
    if (error) throw new AppError(error.message, 500);

    console.log("[savari-bot] PUT /config saved ok vendor_id=", config.vendor_id);

    const vendorId = config.vendor_id;
    const { data: configRow } = await supabase
      .from("savari_bot_config")
      .select("*")
      .eq("vendor_id", vendorId)
      .single();
    const { data: routeRows } = await supabase
      .from("savari_bot_routes")
      .select("*")
      .eq("vendor_id", vendorId)
      .order("direction")
      .order("sort_order")
      .order("city");

    res.json({ success: true, data: { config: configRow, routes: routeRows ?? [] } });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/savari-bot/token — update just the Savaari vendorToken for a vendor.
 * Kept separate from /config (which goes through an RPC) so refreshing the
 * rotating token is a one-field, no-redeploy operation.
 * Body: { vendor_id, token }
 */
router.put("/token", async (req, res, next) => {
  try {
    const vendorId = String(req.body?.vendor_id ?? "").trim();
    const token = String(req.body?.token ?? "").trim();
    if (!vendorId) throw new AppError("vendor_id is required", 400);

    const { error } = await supabase
      .from("savari_bot_config")
      .update({ savaari_vendor_token: token || null })
      .eq("vendor_id", vendorId);
    if (error) throw new AppError(error.message, 500);

    console.log("[savari-bot] PUT /token vendor_id=", vendorId, "len=", token.length);
    res.json({ success: true, data: { ok: true } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
