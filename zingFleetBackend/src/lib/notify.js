/**
 * Push notifications (ntfy.sh) + dead-man's-switch pings (healthchecks.io)
 * for the Savari bot. Topic + ping URL are DB-backed (savari_bot_config,
 * same pattern as the Savaari vendorToken) so they're editable from the Bot
 * -> Config panel — no .env edit / redeploy needed. Falls back to env if the
 * DB columns are empty, and is a no-op (with a log line) if neither is set,
 * so this ships without requiring accounts to exist yet.
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
  try {
    const { data } = await supabase
      .from("savari_bot_config")
      .select("ntfy_topic, healthchecks_url")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.ntfy_topic && String(data.ntfy_topic).trim()) ntfyTopic = String(data.ntfy_topic).trim();
    if (data?.healthchecks_url && String(data.healthchecks_url).trim()) healthchecksUrl = String(data.healthchecks_url).trim();
  } catch {
    /* fall back to whatever env provided */
  }

  _configCache = { at: now, ntfyTopic, healthchecksUrl };
  return _configCache;
}

async function sendNtfy({ title, message, priority = "high", tags = [] }) {
  const { ntfyTopic } = await loadAlertConfig();
  if (!ntfyTopic) {
    console.warn("[notify] no ntfy topic configured (Bot -> Config, or NTFY_TOPIC env) — skipping push:", title);
    return;
  }
  try {
    await fetch(`${NTFY_SERVER}/${encodeURIComponent(ntfyTopic)}`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        Title: title,
        Priority: priority,
        Tags: tags.join(","),
      },
      body: message,
    });
  } catch (e) {
    console.error("[notify] ntfy send failed:", e?.message || e);
  }
}

async function pingHealthcheck(suffix = "") {
  const { healthchecksUrl } = await loadAlertConfig();
  if (!healthchecksUrl) return;
  try {
    await fetch(`${healthchecksUrl}${suffix}`, { method: "GET" });
  } catch (e) {
    console.error("[notify] healthchecks ping failed:", e?.message || e);
  }
}

const pingHealthcheckOk = () => pingHealthcheck("");
const pingHealthcheckFail = () => pingHealthcheck("/fail");

module.exports = { sendNtfy, pingHealthcheckOk, pingHealthcheckFail };
