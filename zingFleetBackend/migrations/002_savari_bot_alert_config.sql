-- Migration 002: alert config columns on savari_bot_config
-- Run in the SQL editor of the MAIN Supabase project (gqkeacjchkkujhbdvevf).
-- Moves the ntfy topic + healthchecks ping URL out of .env so they're
-- editable from the Bot -> Config panel, same pattern as savaari_vendor_token.
-- Idempotent: safe to re-run.

alter table public.savari_bot_config add column if not exists ntfy_topic text;
alter table public.savari_bot_config add column if not exists healthchecks_url text;
