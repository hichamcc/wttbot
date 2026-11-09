import { config } from '../config.js';
import { query } from '../db.js';
import { logger } from '../logger.js';

const log = logger.child({ module: 'history' });

/** Last HISTORY_TURNS question/answer pairs for this person in this chat, oldest first. */
export async function loadHistory(chatJid, phone) {
  const limit = config.history.turns * 2;
  try {
    const rows = await query(
      `SELECT role, text FROM wa_messages
       WHERE chat_jid = ? AND phone = ? AND cleared = 0
         AND created_at >= NOW() - INTERVAL ? MINUTE
       ORDER BY id DESC LIMIT ${limit}`,
      [chatJid, phone, config.history.maxAgeMinutes],
    );
    return rows.reverse();
  } catch (err) {
    log.warn({ err: err.message }, 'could not load history');
    return [];
  }
}

export async function saveTurn(chatJid, phone, question, answerText) {
  try {
    await query(
      'INSERT INTO wa_messages (chat_jid, phone, role, text) VALUES (?, ?, ?, ?), (?, ?, ?, ?)',
      [chatJid, phone, 'user', question, chatJid, phone, 'model', answerText],
    );
  } catch (err) {
    log.warn({ err: err.message }, 'could not save history');
  }
}

export async function clearHistory(chatJid, phone) {
  await query('UPDATE wa_messages SET cleared = 1 WHERE chat_jid = ? AND phone = ?', [chatJid, phone]);
}

export async function logRequest(entry) {
  try {
    await query(
      `INSERT INTO wa_logs (chat_jid, phone, is_group, bil, question, answer, tool_calls, tokens_in, tokens_out, latency_ms, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.chatJid,
        entry.phone,
        entry.isGroup ? 1 : 0,
        entry.bil ?? null,
        entry.question,
        entry.answer ?? null,
        entry.toolCalls ? JSON.stringify(entry.toolCalls) : null,
        entry.usage?.input ?? null,
        entry.usage?.output ?? null,
        entry.latencyMs ?? null,
        entry.error ?? null,
      ],
    );
  } catch (err) {
    log.warn({ err: err.message }, 'could not write request log');
  }
}
