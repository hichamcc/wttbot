import { answer, isRetryable } from './ai/gemini.js';
import { helpText } from './ai/prompt.js';
import { resolveContext } from './identity/resolver.js';
import { logger } from './logger.js';
import { settings } from './settings.js';
import { clearHistory, loadHistory, logRequest, saveTurn } from './store/history.js';

const log = logger.child({ module: 'router' });
// Fixed replies; the ones editable from the dashboard are read from settings() in reply().
const REPLIES = {
  busy: '⏳ Still working on your previous question…',
  rate_limited: 'You have asked a lot of questions in a short time. Please wait a few minutes.',
  ai_quota: '⏳ Too many questions right now. Please try again in a minute.',
  empty: 'Sorry, I could not find an answer. Please contact the office.',
};

function reply(name) {
  return settings()[`reply_${name}`] ?? REPLIES[name];
}

/**
 * "/bot what is my next trip" -> "what is my next trip"; "/bot" -> "".
 * Returns null when the message is not addressed to the bot.
 */
export function parseTrigger(text) {
  const trigger = settings().trigger;
  const trimmed = String(text || '').trim();
  if (!trimmed.toLowerCase().startsWith(trigger)) return null;
  const rest = trimmed.slice(trigger.length);
  // "/botanical" is not "/bot".
  if (rest && !/^[\s,:]/.test(rest)) return null;
  return rest.replace(/^[\s,:]+/, '').trim();
}

// Sliding-window rate limit per phone number (in memory; resets on restart).
const hits = new Map();
function rateLimited(phone) {
  const { rate_limit_max: max, rate_limit_window_minutes: windowMinutes } = settings();
  const windowMs = windowMinutes * 60_000;
  const now = Date.now();
  const recent = (hits.get(phone) || []).filter((t) => now - t < windowMs);
  if (recent.length >= max) return true;
  recent.push(now);
  hits.set(phone, recent);
  return false;
}

// One question at a time per person per chat.
const busy = new Set();

/**
 * Handle one incoming message. Returns the reply text, or null when the bot should stay quiet.
 * msg: { chatJid, isGroup, senderPhone, text }
 */
export async function handleMessage(msg) {
  if (!settings().bot_enabled) return null;
  const question = parseTrigger(msg.text);
  if (question === null) return null;

  if (!question || /^(help|hjælp|hilfe|pomoc|\?)$/i.test(question)) return helpText(settings().trigger);
  if (!msg.senderPhone) return reply('unknown_number');

  if (/^(reset|new|ny|neu|nowy)$/i.test(question)) {
    await clearHistory(msg.chatJid, msg.senderPhone);
    return '✅ Conversation reset.';
  }

  const key = `${msg.chatJid}|${msg.senderPhone}`;
  if (busy.has(key)) return REPLIES.busy;
  if (rateLimited(msg.senderPhone)) return REPLIES.rate_limited;

  busy.add(key);
  const started = Date.now();
  const entry = { chatJid: msg.chatJid, phone: msg.senderPhone, isGroup: msg.isGroup, question };

  try {
    const ctx = await resolveContext({ senderPhone: msg.senderPhone });
    log.info({ ms: Date.now() - started, ok: ctx.ok, bil: ctx.bil, staff: ctx.isStaff }, 'context resolved');
    if (!ctx.ok) {
      await logRequest({ ...entry, error: ctx.reason, latencyMs: Date.now() - started });
      return reply(ctx.reason);
    }

    const history = await loadHistory(msg.chatJid, msg.senderPhone);
    const result = await answer(ctx, question, history);
    const text = result.text || REPLIES.empty;

    await saveTurn(msg.chatJid, msg.senderPhone, question, text);
    await logRequest({ ...entry, bil: ctx.bil, answer: text, toolCalls: result.toolCalls, usage: result.usage, model: result.model, latencyMs: Date.now() - started });
    log.info({ phone: msg.senderPhone, bil: ctx.bil, model: result.model, tools: result.toolCalls.map((t) => t.name), ms: Date.now() - started }, 'answered');
    return text;
  } catch (err) {
    log.error({ err }, 'failed to answer');
    await logRequest({ ...entry, error: String(err.message || err).slice(0, 1000), latencyMs: Date.now() - started });
    if (err.status === 429) return REPLIES.ai_quota;
    return isRetryable(err) ? reply('ai_busy') : reply('error');
  } finally {
    busy.delete(key);
  }
}
