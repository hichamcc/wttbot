import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name} (see .env.example)`);
  return value;
}

function int(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : Number.parseInt(value, 10);
}

function list(name) {
  return (process.env[name] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  logLevel: process.env.LOG_LEVEL || 'info',
  timezone: process.env.TIMEZONE || 'Europe/Copenhagen',

  whatsapp: {
    authDir: process.env.WA_AUTH_DIR || './auth',
    trigger: (process.env.BOT_TRIGGER || '/bot').toLowerCase(),
    // Empty = the bot answers in every group it is in. For the MVP, list the test group JIDs.
    allowedGroups: list('ALLOWED_GROUPS'),
  },

  gemini: {
    apiKey: required('GEMINI_API_KEY'),
    model: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
    maxToolRounds: int('GEMINI_MAX_TOOL_ROUNDS', 5),
  },

  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: int('DB_PORT', 3306),
    user: required('DB_USER'),
    password: process.env.DB_PASSWORD || '',
    database: required('DB_NAME'),
  },

  companyId: int('COMPANY_ID', 1),

  mapon: {
    apiKey: required('MAPON_API_KEY'),
    baseUrl: process.env.MAPON_BASE_URL || 'https://mapon.com/api/v1',
    cacheMinutes: int('MAPON_CACHE_MINUTES', 10),
  },

  // Country used to read local phone numbers stored without a +prefix (in Mapon or overrides).
  defaultPhoneCountry: process.env.DEFAULT_PHONE_COUNTRY || 'DK',

  rateLimit: {
    max: int('RATE_LIMIT_MAX', 10),
    windowMinutes: int('RATE_LIMIT_WINDOW_MINUTES', 10),
  },

  history: {
    turns: int('HISTORY_TURNS', 6),
    maxAgeMinutes: int('HISTORY_MAX_AGE_MINUTES', 120),
  },
};
