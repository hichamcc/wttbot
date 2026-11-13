// Live settings: .env values are the defaults, rows in wa_settings (edited from the WTT admin
// dashboard, admin/whatsapp_bot/settings.php) override them. Reloaded every minute, so changes
// apply without restarting the bot. API keys and DB credentials are never read from here.
import { config } from './config.js';
import { query } from './db.js';
import { logger } from './logger.js';

const log = logger.child({ module: 'settings' });

// Trip text fields that may ever be shown to drivers; the dashboard picks a subset.
export const TRIP_TEXT_FIELDS = ['cargoref', 'unload_ref', 'temp', 'load_type', 'notes', 'info'];

const THINKING_LEVELS = ['', 'minimal', 'low', 'medium', 'high'];

const DEFAULT_REPLIES = {
  reply_unknown_number:
    'Sorry, your WhatsApp number is not registered in WTTsystem / Mapon. Please ask the office to add your phone number.',
  reply_no_truck:
    'I found you, but no truck is linked to you in Mapon right now. Please ask the office to check your truck assignment.',
  reply_ai_busy: '⏳ The AI service is very busy right now. Please try again in a minute.',
  reply_error: 'Sorry, something went wrong. Please try again, or contact the office.',
};

function defaults() {
  return {
    bot_enabled: true,
    trigger: config.whatsapp.trigger,
    allowed_groups: config.whatsapp.allowedGroups,
    gemini_model: config.gemini.model,
    gemini_fallback_models: config.gemini.fallbackModels,
    gemini_thinking_level: config.gemini.thinkingLevel,
    gemini_timeout_ms: config.gemini.timeoutMs,
    rate_limit_max: config.rateLimit.max,
    rate_limit_window_minutes: config.rateLimit.windowMinutes,
    history_turns: config.history.turns,
    history_max_age_minutes: config.history.maxAgeMinutes,
    trip_text_fields: TRIP_TEXT_FIELDS,
    extra_prompt: '',
    ...DEFAULT_REPLIES,
  };
}

const splitList = (v) => String(v).split(/[\n,]/).map((s) => s.trim()).filter(Boolean);

// How each stored string becomes a typed value. Invalid values fall back to the default.
const PARSERS = {
  bot_enabled: (v) => v === '1' || v === 'true',
  trigger: (v) => (v.trim() ? v.trim().toLowerCase() : undefined),
  allowed_groups: splitList,
  gemini_model: (v) => v.trim() || undefined,
  gemini_fallback_models: splitList,
  gemini_thinking_level: (v) => (THINKING_LEVELS.includes(v.trim().toLowerCase()) ? v.trim().toLowerCase() : undefined),
  gemini_timeout_ms: intBetween(3_000, 120_000),
  rate_limit_max: intBetween(1, 1000),
  rate_limit_window_minutes: intBetween(1, 1440),
  history_turns: intBetween(0, 20),
  history_max_age_minutes: intBetween(1, 10_080),
  trip_text_fields: (v) => splitList(v).filter((f) => TRIP_TEXT_FIELDS.includes(f)),
  extra_prompt: (v) => v.trim(),
  ...Object.fromEntries(Object.keys(DEFAULT_REPLIES).map((k) => [k, (v) => v.trim() || undefined])),
};

function intBetween(min, max) {
  return (v) => {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
  };
}

let current = defaults();

/** Current effective settings (always available; starts as the .env defaults). */
export function settings() {
  return current;
}

export async function loadSettings() {
  const rows = await query('SELECT name, value FROM wa_settings');
  const next = defaults();
  for (const { name, value } of rows) {
    const parse = PARSERS[name];
    if (!parse || value === null) continue;
    const parsed = parse(String(value));
    if (parsed !== undefined) next[name] = parsed;
  }
  current = next;
  return current;
}

export async function startSettingsRefresh(intervalMs = 60_000) {
  try {
    await loadSettings();
    log.info('settings loaded');
  } catch (err) {
    log.warn({ err: err.message }, 'wa_settings not readable, using .env defaults');
  }
  setInterval(() => {
    loadSettings().catch((err) => log.warn({ err: err.message }, 'settings refresh failed, keeping previous'));
  }, intervalMs).unref();
}
