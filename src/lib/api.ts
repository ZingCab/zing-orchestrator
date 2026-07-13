/**
 * ZingCab Fleet — API Client
 * Talks to the Express backend. All data flows through here.
 * snake_case ↔ camelCase mapping handled transparently.
 */

/**
 * Backend base URL. Must be HTTPS when the app is served over HTTPS (Vercel),
 * or the browser blocks requests (mixed content).
 *
 * Default is the production API. Override locally with `VITE_API_BASE_URL` in `.env`
 * (optional) — e.g. `http://localhost:3001` for development.
 */
const DEFAULT_API_BASE = "https://fleet.zingcab.in";

function apiBase(): string {
  const raw = import.meta.env.VITE_API_BASE_URL?.trim();
  if (raw) return raw.replace(/\/$/, "");
  return DEFAULT_API_BASE;
}
 
const API_BASE = apiBase();

// ─── snake_case ↔ camelCase helpers ──────────────────────

function toSnake(str: string): string {
  return str.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}
/** snake_case → camelCase. Handles digits (e.g. rental_min_8h_80km → rentalMin8h80km). */
function toCamel(str: string): string {
  if (!str.includes("_")) return str;
  const parts = str.split("_");
  return parts[0] + parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
}

function keysToSnake(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[toSnake(k)] = v;
  }
  return out;
}

function keysToCamel<T>(obj: unknown): T {
  if (Array.isArray(obj)) return obj.map((item) => keysToCamel(item)) as T;
  if (obj !== null && typeof obj === "object" && !(obj instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out[toCamel(k)] = keysToCamel(v);
    }
    return out as T;
  }
  return obj as T;
}

// ─── Error class ─────────────────────────────────────────

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

// ─── Core fetch wrapper ──────────────────────────────────

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
  } catch {
    throw new ApiError("Cannot reach the server. Check if the backend is running.", 0);
  }

  if (res.status === 401) {
    // Auth expired
    localStorage.removeItem("zingcab_auth");
    window.location.href = "/login";
    throw new ApiError("Session expired", 401);
  }

  const json = await res.json().catch(() => ({ success: false, error: "Invalid response" }));

  if (!res.ok || !json.success) {
    throw new ApiError(json.error || `Request failed (${res.status})`, res.status);
  }

  return keysToCamel<T>(json.data);
}

function qs(params?: Record<string, string | undefined>): string {
  if (!params) return "";
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") clean[k] = v;
  }
  const s = new URLSearchParams(clean).toString();
  return s ? `?${s}` : "";
}

function body(data: Record<string, unknown>): string {
  return JSON.stringify(keysToSnake(data));
}

// ─── API methods ─────────────────────────────────────────

export const api = {
  // Auth
  login: (pin: string) =>
    request<{ authenticated: boolean }>("/api/auth/login", { method: "POST", body: JSON.stringify({ pin }) }),

  // Health
  health: () => request<{ status: string }>("/health"),

  /** Savaari vendor feed (proxied GET). Vendor token is set in backend `routes/savaari.js`. */
  getSavaariBroadcasts: (params?: { booking_id?: string }) =>
    request<{
      items: Record<string, unknown>[];
      status?: boolean;
      /** Upstream summary; includes totalCount, carTypes, counts by segment, etc. */
      resultset?: Record<string, unknown>;
    }>(`/api/savaari/new-business${qs(params)}`),

  /** Bot config + routes (Supabase via Express). */
  getSavariBotConfig: (vendorId: string) =>
    request<{ config: Record<string, unknown> | null; routes: Record<string, unknown>[] }>(
      `/api/savari-bot/config${qs({ vendor_id: vendorId })}`,
    ),

  putSavariBotConfig: (body: { config: Record<string, unknown>; routes: Record<string, unknown>[] }) =>
    request<{ config: Record<string, unknown>; routes: Record<string, unknown>[] }>(
      "/api/savari-bot/config",
      { method: "PUT", body: JSON.stringify(body) },
    ),

  /** Update just the (rotating) Savaari vendor token for a vendor. */
  putSavariBotToken: (vendorId: string, token: string) =>
    request<{ ok: boolean }>("/api/savari-bot/token", {
      method: "PUT",
      body: JSON.stringify({ vendor_id: vendorId, token }),
    }),

  // Drivers
  getDrivers: () => request<any[]>("/api/drivers"),
  getSettlementModeHistory: () => request<any[]>("/api/drivers/settlement-mode-history"),
  getDriver: (id: string) => request<any>(`/api/drivers/${id}`),
  createDriver: (data: Record<string, unknown>) =>
    request<any>("/api/drivers", { method: "POST", body: body(data) }),
  updateDriver: (id: string, data: Record<string, unknown>) =>
    request<any>(`/api/drivers/${id}`, { method: "PUT", body: body(data) }),
  deleteDriver: (id: string) =>
    request<null>(`/api/drivers/${id}`, { method: "DELETE" }),

  // Cars
  getCars: () => request<any[]>("/api/cars"),
  getCar: (id: string) => request<any>(`/api/cars/${id}`),
  createCar: (data: Record<string, unknown>) =>
    request<any>("/api/cars", { method: "POST", body: body(data) }),
  updateCar: (id: string, data: Record<string, unknown>) =>
    request<any>(`/api/cars/${id}`, { method: "PUT", body: body(data) }),
  deleteCar: (id: string) =>
    request<null>(`/api/cars/${id}`, { method: "DELETE" }),

  // Cash Entries
  getCashEntries: (params?: { driver_id?: string; week_start?: string }) =>
    request<any[]>(`/api/cash${qs(params)}`),
  createCashEntry: (data: Record<string, unknown>) =>
    request<any>("/api/cash", { method: "POST", body: body(data) }),
  deleteCashEntry: (id: string) =>
    request<null>(`/api/cash/${id}`, { method: "DELETE" }),

  // Vendor Entries
  getVendorEntries: (params?: { driver_id?: string; week_start?: string }) =>
    request<any[]>(`/api/vendor${qs(params)}`),
  createVendorEntry: (data: Record<string, unknown>) =>
    request<any>("/api/vendor", { method: "POST", body: body(data) }),
  deleteVendorEntry: (id: string) =>
    request<null>(`/api/vendor/${id}`, { method: "DELETE" }),

  // Fuel Entries
  getFuelEntries: (params?: { driver_id?: string; week_start?: string; car_id?: string }) =>
    request<any[]>(`/api/fuel${qs(params)}`),
  createFuelEntry: (data: Record<string, unknown>) =>
    request<any>("/api/fuel", { method: "POST", body: body(data) }),
  deleteFuelEntry: (id: string) =>
    request<null>(`/api/fuel/${id}`, { method: "DELETE" }),

  // Other Costs
  getOtherCosts: (params?: { driver_id?: string; week_start?: string }) =>
    request<any[]>(`/api/other-costs${qs(params)}`),
  createOtherCost: (data: Record<string, unknown>) =>
    request<any>("/api/other-costs", { method: "POST", body: body(data) }),
  deleteOtherCost: (id: string) =>
    request<null>(`/api/other-costs/${id}`, { method: "DELETE" }),

  // Other Earnings
  getOtherEarnings: (params?: { driver_id?: string; week_start?: string }) =>
    request<any[]>(`/api/other-earnings${qs(params)}`),
  createOtherEarning: (data: Record<string, unknown>) =>
    request<any>("/api/other-earnings", { method: "POST", body: body(data) }),
  deleteOtherEarning: (id: string) =>
    request<null>(`/api/other-earnings/${id}`, { method: "DELETE" }),

  // Settlements
  getSettlements: (params?: { driver_id?: string; week_start?: string }) =>
    request<any[]>(`/api/settlements${qs(params)}`),
  createSettlement: (data: Record<string, unknown>) =>
    request<any>("/api/settlements", { method: "POST", body: body(data) }),
  updateSettlement: (id: string, data: Record<string, unknown>) =>
    request<any>(`/api/settlements/${id}`, { method: "PUT", body: body(data) }),
  deleteSettlement: (id: string) =>
    request<null>(`/api/settlements/${id}`, { method: "DELETE" }),

  // Car Costs
  getCarCosts: (params?: { car_id?: string }) =>
    request<any[]>(`/api/car-costs${qs(params)}`),
  createCarCost: (data: Record<string, unknown>) =>
    request<any>("/api/car-costs", { method: "POST", body: body(data) }),
  deleteCarCost: (id: string) =>
    request<null>(`/api/car-costs/${id}`, { method: "DELETE" }),

  // Car Documents
  getCarDocs: (params?: { car_id?: string }) =>
    request<any[]>(`/api/car-docs${qs(params)}`),
  createCarDoc: (data: Record<string, unknown>) =>
    request<any>("/api/car-docs", { method: "POST", body: body(data) }),
  deleteCarDoc: (id: string) =>
    request<null>(`/api/car-docs/${id}`, { method: "DELETE" }),

  // Savari Analytics
  getSavariAnalyticsDashboard: () => request<any>("/api/savari-analytics/dashboard"),

  // Settings
  getSettings: () => request<{ fuelThreshold: number }>("/api/settings"),
  updateSettings: (data: Record<string, unknown>) =>
    request<any>("/api/settings", { method: "PUT", body: body(data) }),
};
