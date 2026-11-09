import { answer } from './ai/gemini.js';
import { helpText } from './ai/prompt.js';
import { config } from './config.js';
import { resolveContext } from './identity/resolver.js';
import { logger } from './logger.js';
import { clearHistory, loadHistory, logRequest, saveTurn } from './store/history.js';

const log = logger.child({ module: 'router' });
const trigger = config.whatsapp.trigger;

const REPLIES = {
  unknown_number:
    'Sorry, your WhatsApp number is not registered in WTTsystem / Mapon. Please ask the office to add your phone number.',
  no_truck:
    'I found you, but no truck is linked to you in Mapon right now. Please ask the office to check your truck assignment.',
  busy: '⏳ Still working on your previous question…',
  rate_limited: 'You have asked a lot of questions in a short time. Please wait a few minutes.',
  error: 'Sorry, something went wrong. Please try again, or contact the office.',
  empty: 'Sorry, I could not find an answer. Please contact the office.',
};

/**
 * "/bot what is my next trip" -> "what is my next trip"; "/bot" -> "".
 * Returns null when the message is not addressed to the bot.
 */
export function parseTrigger(text) {
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
  const windowMs = config.rateLimit.windowMinutes * 60_000;
  const now = Date.now();
  const recent = (hits.get(phone) || []).filter((t) => now - t < windowMs);
  if (recent.length >= config.rateLimit.max) return true;
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
  const question = parseTrigger(msg.text);
  if (question === null) return null;

  if (!question || /^(help|hjælp|hilfe|pomoc|\?)$/i.test(question)) return helpText(trigger);
  if (!msg.senderPhone) return REPLIES.unknown_number;

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
    if (!ctx.ok) {
      await logRequest({ ...entry, error: ctx.reason, latencyMs: Date.now() - started });
      return REPLIES[ctx.reason];
    }

    const history = await loadHistory(msg.chatJid, msg.senderPhone);
    const result = await answer(ctx, question, history);
    const text = result.text || REPLIES.empty;

    await saveTurn(msg.chatJid, msg.senderPhone, question, text);
    await logRequest({ ...entry, bil: ctx.bil, answer: text, toolCalls: result.toolCalls, usage: result.usage, latencyMs: Date.now() - started });
    log.info({ phone: msg.senderPhone, bil: ctx.bil, tools: result.toolCalls.map((t) => t.name), ms: Date.now() - started }, 'answered');
    return text;
  } catch (err) {
    log.error({ err }, 'failed to answer');
    await logRequest({ ...entry, error: String(err.message || err).slice(0, 1000), latencyMs: Date.now() - started });
    return REPLIES.error;
  } finally {
    busy.delete(key);
  }
}
