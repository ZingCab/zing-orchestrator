/**
 * Shared Savaari vendor session + upstream fetch (used by /api/savaari routes and the bot scheduler).
 */

const { supabase } = require("./supabase");

const DEFAULT_BOOKING_API =
  "https://vendor.savaari.com/vendor/api/booking/v1/booking.php";

/**
 * Same as vendorToken on vendor.savaari.com. This is a per-session token that
 * ROTATES/EXPIRES — set SAVAARI_VENDOR_TOKEN in the backend .env and refresh it
 * when the feed goes empty (copy the current vendorToken from a logged-in
 * vendor.savaari.com session). The baked-in value is only a last-resort default
 * and will eventually go stale.
 */
const SAVAARI_VENDOR_TOKEN =
  process.env.SAVAARI_VENDOR_TOKEN ||
  "SkM5QmlFaVFsNEdvVjRHbFB4N2pXdXcrQjFSc296YmNPMnAzTUVkbWtYYUhjeDJmNVdrU3JlR2VWNHYxVnVWcHAyL0pSTGVBQjVJU0ZMeEgwQVVZTmFyWStuSitQcUh0cVpzaTFqOGhZc0E1a0ZFMUFTK0ZMeW0zYUd1dGlleXc=";

// Token source of truth is savari_bot_config.savaari_vendor_token in Supabase
// (updatable from the Bot dashboard). Falls back to env, then the baked value.
// Cached briefly so we don't hit the DB on every upstream call.
let _tokenCache = { at: 0, token: "" };
const TOKEN_TTL_MS = 60000;

async function getVendorToken() {
  const now = Date.now();
  if (_tokenCache.token && now - _tokenCache.at < TOKEN_TTL_MS) return _tokenCache.token;
  let token = SAVAARI_VENDOR_TOKEN;
  try {
    const { data } = await supabase
      .from("savari_bot_config")
      .select("savaari_vendor_token")
      .not("savaari_vendor_token", "is", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const dbToken = data && data.savaari_vendor_token && String(data.savaari_vendor_token).trim();
    if (dbToken) token = dbToken;
  } catch {
    /* fall back to env / baked default */
  }
  _tokenCache = { at: now, token };
  return token;
}

const HEADERS = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9,hi;q=0.8",
  Referer: "https://vendor.savaari.com/vendor/layout.html",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
};

// Vendor endpoint appears to rely on a "vendor session" across calls.
// Keep cookies from getNewBusiness and reuse them for postInterest.
let vendorCookieHeader = "";

function rememberVendorCookies(upstreamRes) {
  try {
    // undici/Node fetch supports getSetCookie() in recent versions.
    const setCookies = upstreamRes.headers.getSetCookie
      ? upstreamRes.headers.getSetCookie()
      : (upstreamRes.headers.get && upstreamRes.headers.get("set-cookie")
          ? [upstreamRes.headers.get("set-cookie")]
          : []);

    if (!setCookies || !Array.isArray(setCookies) || setCookies.length === 0) return;

    // Convert "name=value; ..." entries into a Cookie header: "name=value; name2=value2"
    const cookiePairs = setCookies
      .map((c) => String(c).split(";")[0])
      .map((p) => p.trim())
      .filter(Boolean);

    if (cookiePairs.length) vendorCookieHeader = cookiePairs.join("; ");
  } catch {
    // Best-effort only. If cookies can't be captured, requests still proceed.
  }
}

function cookieHeaders() {
  return vendorCookieHeader ? { Cookie: vendorCookieHeader } : {};
}

/**
 * @param {string} [bookingId]
 * @returns {Promise<object>} raw upstream JSON
 */
async function fetchSavaariNewBusiness(bookingId = "0") {
  const base =
    (process.env.SAVAARI_BOOKING_API_URL || "").trim() || DEFAULT_BOOKING_API;
  const url = new URL(base);
  url.searchParams.set("action", "getNewBusiness");
  url.searchParams.set("vendorToken", await getVendorToken());
  url.searchParams.set("booking_id", String(bookingId));

  const upstreamRes = await fetch(url.toString(), {
    method: "GET",
    headers: HEADERS,
  });

  rememberVendorCookies(upstreamRes);

  const text = await upstreamRes.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Savaari returned non-JSON response");
  }

  if (!upstreamRes.ok) {
    const err = new Error(`Savaari HTTP ${upstreamRes.status}`);
    err.status = upstreamRes.status;
    throw err;
  }

  return json;
}

/**
 * Confirmed/won upcoming trips (different dataset from the broadcast feed).
 * Vendor endpoint takes this as a POST form body, unlike getNewBusiness.
 * @returns {Promise<object>} raw upstream JSON
 */
async function fetchSavaariUpcomingBookings() {
  const base =
    (process.env.SAVAARI_BOOKING_API_URL || "").trim() || DEFAULT_BOOKING_API;

  const body = new URLSearchParams();
  body.set("action", "getUpcomingBookings");
  body.set("vendorToken", await getVendorToken());
  body.set("booking_id", "");
  body.set("start_date", "");
  body.set("end_date", "");

  const upstreamRes = await fetch(base, {
    method: "POST",
    headers: { ...HEADERS, "Content-Type": "application/x-www-form-urlencoded", ...cookieHeaders() },
    body: body.toString(),
  });

  rememberVendorCookies(upstreamRes);

  const text = await upstreamRes.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Savaari returned non-JSON response");
  }

  if (!upstreamRes.ok) {
    const err = new Error(`Savaari HTTP ${upstreamRes.status}`);
    err.status = upstreamRes.status;
    throw err;
  }

  return json;
}

/**
 * POST interest / bid on a broadcast (REAL MONEY — same vendor session as getNewBusiness).
 * Param names follow vendor `booking.php`; if upstream rejects, capture DevTools request and align fields.
 *
 * @param {{ bookingId: string|number, vendorCost?: string|number, broadcastId?: string|number }} p
 */
async function postSavaariPostInterest(p) {
  const base =
    (process.env.SAVAARI_BOOKING_API_URL || "").trim() || DEFAULT_BOOKING_API;
  const url = new URL(base);

  // Match the vendor panel curl exactly (GET with required query parameters).
  // Your working curl uses:
  //   action=postInterest&vendor_id=175236&broadcast_id=...&booking_id=...
  //   &vendor_cost=2997&bidding_cost=0&rebidding=0&priority_popup_flag=0
  //   &packed_bookings=&other_packed_bookings=
  url.search = "";
  const params = url.searchParams;

  params.set("action", "postInterest");
  // Include vendorToken too. Some sessions accept cookies-only, others require token.
  params.set("vendorToken", await getVendorToken());
  params.set("vendor_id", String(p.vendorId ?? "").trim());
  params.set("broadcast_id", String(p.broadcastId ?? "").trim());
  params.set("booking_id", String(p.bookingId ?? "").trim());

  if (p.vendorCost != null && String(p.vendorCost).trim() !== "") {
    params.set("vendor_cost", String(p.vendorCost).trim());
  }

  params.set("bidding_cost", String(p.biddingCost ?? 0));
  params.set("rebidding", String(p.rebidding ?? 0));
  params.set("priority_popup_flag", String(p.priorityPopupFlag ?? 0));

  // Required keys even when empty.
  params.set("packed_bookings", "");
  params.set("other_packed_bookings", "");

  const cookieLen = vendorCookieHeader ? vendorCookieHeader.length : 0;
  // Keep URL logging concise: full query string can include many keys.
  console.log("[savaari-bid-debug]", {
    url: url.toString(),
    cookie_header_present: cookieLen > 0,
    cookie_len: cookieLen,
    vendor_id: p.vendorId ?? null,
    booking_id: p.bookingId ?? null,
    broadcast_id: p.broadcastId ?? null,
  });

  const upstreamRes = await fetch(url.toString(), {
    method: "GET",
    headers: {
      ...HEADERS,
      ...cookieHeaders(),
    },
  });

  const text = await upstreamRes.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Savaari returned non-JSON response");
  }

  if (!upstreamRes.ok) {
    const err = new Error(`Savaari HTTP ${upstreamRes.status}`);
    err.status = upstreamRes.status;
    err.upstream = json;
    throw err;
  }

  return json;
}

module.exports = {
  SAVAARI_VENDOR_TOKEN,
  DEFAULT_BOOKING_API,
  fetchSavaariNewBusiness,
  fetchSavaariUpcomingBookings,
  postSavaariPostInterest,
};
