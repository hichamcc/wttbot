// Ask the bot a question from the terminal, as if sent from a WhatsApp number.
// Uses the real identity lookup, database and Gemini, but no WhatsApp connection.
// Usage: npm run ask -- +4512345678 "/bot what is my next trip?"
import { pool } from '../src/db.js';
import { normalizePhone } from '../src/identity/phone.js';
import { handleMessage } from '../src/router.js';

const [rawPhone, ...words] = process.argv.slice(2);
const phone = normalizePhone(rawPhone);
if (!phone || !words.length) {
  console.error('Usage: npm run ask -- <phone> "/bot your question"');
  process.exit(1);
}

let text = words.join(' ');
if (!text.trim().startsWith('/')) text = `/bot ${text}`;

const reply = await handleMessage({ chatJid: `cli:${phone}`, isGroup: false, senderPhone: phone, text });
console.log(reply ?? '(no reply: message was not addressed to the bot)');

await pool.end();
