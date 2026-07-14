/**
 * Push notifications (ntfy.sh) + dead-man's-switch pings (healthchecks.io)
 * for the Savari bot. Topic + ping URL are DB-backed (savari_bot_config,
 * same pattern as the Savaari vendorToken) so they're editable from the Bot
 * -> Config panel — no .env edit / redeploy needed. Falls back to env if the
 * DB columns are empty, and is a no-op (with a log line) if neither is set,
 * so this ships without requiring accounts to exist yet.
 *
 * Every call logs its outcome (config resolved, HTTP status, response body on
 * failure) — a bad topic/URL fails silently at the network level (fetch()
 * doesn't throw on 4xx/5xx), so without this logging a misconfiguration looks
 * identical to "nothing happened".
 */

const { supabase } = require("./supabase");

const NTFY_SERVER = (process.env.NTFY_SERVER || "https://ntfy.sh").trim().replace(/\/+$/, "");
const CONFIG_TTL_MS = 60000;
let _configCache = { at: 0, ntfyTopic: "", healthchecksUrl: "" };

async function loadAlertConfig() {
  const now = Date.now();
  if (now - _configCache.at < CONFIG_TTL_MS) return _configCache;

  let ntfyTopic = (process.env.NTFY_TOPIC || "").trim();
  let healthchecksUrl = (process.env.HEALTHCHECKS_URL || "").trim();
  let source = "env";
  try {
    const { data, error } = await supabase
      .from("savari_bot_config")
      .select("ntfy_topic, healthchecks_url")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error("[notify] failed to load alert config from DB, falling back to env:", error.message);
    } else {
      if (data?.ntfy_topic && String(data.ntfy_topic).trim()) {
        ntfyTopic = String(data.ntfy_topic).trim();
        source = "db";
      }
      if (data?.healthchecks_url && String(data.healthchecks_url).trim()) {
        healthchecksUrl = String(data.healthchecks_url).trim();
        source = "db";
      }
    }
  } catch (e) {
    console.error("[notify] alert config lookup threw, falling back to env:", e?.message || e);
  }

  _configCache = { at: now, ntfyTopic, healthchecksUrl };
  console.log("[notify] alert config resolved", {
    source,
    ntfy_topic: ntfyTopic || "(none)",
    healthchecks_url: healthchecksUrl ? `${healthchecksUrl.slice(0, 28)}…` : "(none)",
  });
  return _configCache;
}

async function sendNtfy({ title, message, priority = "high", tags = [] }) {
  const { ntfyTopic } = await loadAlertConfig();
  if (!ntfyTopic) {
    console.warn("[notify] no ntfy topic configured (Bot -> Config, or NTFY_TOPIC env) — skipping push:", title);
    return;
  }
  const url = `${NTFY_SERVER}/${encodeURIComponent(ntfyTopic)}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        Title: title,
        Priority: priority,
        Tags: tags.join(","),
      },
      body: message,
    });
    const bodyText = await res.text().catch(() => "");
    if (res.ok) {
      console.log("[notify] ntfy push sent", { topic: ntfyTopic, title, status: res.status });
    } else {
      console.error("[notify] ntfy push REJECTED", { topic: ntfyTopic, title, status: res.status, body: bodyText.slice(0, 300) });
    }
  } catch (e) {
    console.error("[notify] ntfy send failed (network error):", { topic: ntfyTopic, message: e?.message || e });
  }
}

async function pingHealthcheck(suffix = "") {
  const { healthchecksUrl } = await loadAlertConfig();
  if (!healthchecksUrl) {
    console.warn("[notify] no healthchecks URL configured (Bot -> Config, or HEALTHCHECKS_URL env) — skipping ping" + (suffix ? ` (${suffix})` : ""));
    return;
  }
  try {
    const res = await fetch(`${healthchecksUrl}${suffix}`, { method: "GET" });
    if (res.ok) {
      console.log("[notify] healthchecks ping ok", { suffix: suffix || "(success)", status: res.status });
    } else {
      const bodyText = await res.text().catch(() => "");
      console.error("[notify] healthchecks ping REJECTED", { suffix: suffix || "(success)", status: res.status, body: bodyText.slice(0, 300) });
    }
  } catch (e) {
    console.error("[notify] healthchecks ping failed (network error):", e?.message || e);
  }
}

const pingHealthcheckOk = () => pingHealthcheck("");
const pingHealthcheckFail = () => pingHealthcheck("/fail");

module.exports = { sendNtfy, pingHealthcheckOk, pingHealthcheckFail };
