// List the Gemini models this API key can use for generateContent (what the bot needs).
// Usage: npm run models            (all)
//        npm run models -- flash   (filter by name)
import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';

const filter = (process.argv[2] || '').toLowerCase();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const rows = [];
for await (const m of await ai.models.list({ config: { pageSize: 1000 } })) {
  const name = (m.name || '').replace(/^models\//, '');
  if (!m.supportedActions?.includes('generateContent')) continue;
  if (filter && !name.toLowerCase().includes(filter)) continue;
  rows.push({ name, displayName: m.displayName });
}

console.table(rows.sort((a, b) => a.name.localeCompare(b.name)));
console.log('Use the "name" column in GEMINI_MODEL / GEMINI_FALLBACK_MODELS.');
