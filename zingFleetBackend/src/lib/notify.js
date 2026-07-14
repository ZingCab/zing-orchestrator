/**
 * Push notifications (ntfy.sh) + dead-man's-switch pings (healthchecks.io)
 * for the Savari bot. Both are no-ops with a log line if their env var isn't
 * set, so this ships without requiring accounts to exist yet.
 */

const NTFY_SERVER = (process.env.NTFY_SERVER || "https://ntfy.sh").trim().replace(/\/+$/, "");
const NTFY_TOPIC = (process.env.NTFY_TOPIC || "").trim();
const HEALTHCHECKS_URL = (process.env.HEALTHCHECKS_URL || "").trim();

async function sendNtfy({ title, message, priority = "high", tags = [] }) {
  if (!NTFY_TOPIC) {
    console.warn("[notify] NTFY_TOPIC not set — skipping push:", title);
    return;
  }
  try {
    await fetch(`${NTFY_SERVER}/${encodeURIComponent(NTFY_TOPIC)}`, {
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
  if (!HEALTHCHECKS_URL) return;
  try {
    await fetch(`${HEALTHCHECKS_URL}${suffix}`, { method: "GET" });
  } catch (e) {
    console.error("[notify] healthchecks ping failed:", e?.message || e);
  }
}

const pingHealthcheckOk = () => pingHealthcheck("");
const pingHealthcheckFail = () => pingHealthcheck("/fail");

module.exports = { sendNtfy, pingHealthcheckOk, pingHealthcheckFail };
