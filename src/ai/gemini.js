import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { declarations, runTool } from '../tools/index.js';
import { systemPrompt } from './prompt.js';

const log = logger.child({ module: 'gemini' });
const ai = new GoogleGenAI({
  apiKey: config.gemini.apiKey,
  httpOptions: { timeout: config.gemini.timeoutMs },
});

// Trip lookups don't need deep reasoning; a low level keeps replies fast. Empty = model default.
const thinkingConfig = config.gemini.thinkingLevel
  ? { thinkingConfig: { thinkingLevel: config.gemini.thinkingLevel.toUpperCase() } }
  : {};

// Overloaded, rate limited, or too slow: worth trying another model.
const RETRYABLE = new Set([429, 500, 503, 504]);

function isRetryable(err) {
  return RETRYABLE.has(err?.status) || err?.name === 'AbortError' || /timed? ?out|aborted/i.test(err?.message || '');
}

/**
 * generateContent on the first model that answers. Once a model has answered in this
 * conversation, later rounds stay on it (thought signatures are model-specific).
 */
async function generate(models, request) {
  let lastErr;
  for (const model of models) {
    try {
      return { model, response: await ai.models.generateContent({ ...request, model }) };
    } catch (err) {
      if (!isRetryable(err)) throw err;
      log.warn({ model, status: err.status, err: err.message?.slice(0, 200) }, 'model unavailable, trying next');
      lastErr = err;
    }
  }
  throw lastErr;
}

/**
 * Answer one question with Gemini function calling.
 *
 * history: [{ role: 'user' | 'model', text }] — previous turns of this chat.
 * Returns { text, toolCalls, usage }.
 */
export async function answer(ctx, question, history = []) {
  const contents = [
    ...history.map((h) => ({ role: h.role, parts: [{ text: h.text }] })),
    { role: 'user', parts: [{ text: question }] },
  ];

  const toolCalls = [];
  const usage = { input: 0, output: 0 };
  let models = [config.gemini.model, ...config.gemini.fallbackModels];

  for (let round = 0; round <= config.gemini.maxToolRounds; round++) {
    const t0 = Date.now();
    const { model, response } = await generate(models, {
      contents,
      config: {
        systemInstruction: systemPrompt(ctx),
        tools: [{ functionDeclarations: declarations }],
        temperature: 0.2,
        ...thinkingConfig,
      },
    });
    models = [model];
    log.info({ round, model, ms: Date.now() - t0, calls: response.functionCalls?.map((c) => c.name) ?? [] }, 'gemini round');

    usage.input += response.usageMetadata?.promptTokenCount ?? 0;
    usage.output += response.usageMetadata?.candidatesTokenCount ?? 0;

    const calls = response.functionCalls;
    if (!calls?.length) {
      return { text: response.text?.trim() || '', toolCalls, usage };
    }

    // Keep the model's turn as-is (it carries thought signatures needed for the next call).
    contents.push(response.candidates[0].content);

    const parts = [];
    for (const call of calls) {
      let result;
      const t1 = Date.now();
      try {
        result = await runTool(call.name, call.args, ctx);
        log.info({ tool: call.name, args: call.args, ms: Date.now() - t1 }, 'tool done');
      } catch (err) {
        log.error({ err, tool: call.name }, 'tool failed');
        result = { error: 'The WTT database could not be read right now.' };
      }
      toolCalls.push({ name: call.name, args: call.args });
      parts.push({ functionResponse: { id: call.id, name: call.name, response: { result } } });
    }
    contents.push({ role: 'user', parts });
  }

  log.warn({ toolCalls }, 'tool round limit reached');
  return { text: '', toolCalls, usage };
}
