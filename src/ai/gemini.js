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

// Overloaded, rate limited, or too slow: worth retrying or trying another model.
const RETRYABLE = new Set([429, 500, 503, 504]);

export function isRetryable(err) {
  return RETRYABLE.has(err?.status) || err?.name === 'AbortError' || /timed? ?out|aborted/i.test(err?.message || '');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One generateContent call, cancelled client-side after GEMINI_TIMEOUT_MS. */
function call(request) {
  const abortSignal = AbortSignal.timeout(config.gemini.timeoutMs);
  return ai.models.generateContent({ ...request, config: { ...request.config, abortSignal } });
}

/**
 * generateContent, optionally with one retry after a short pause when the model is busy.
 * Only the last model in the list retries: while other models are left, moving on is faster.
 * A 429 is a quota limit, not a blip, so it is never retried on the same model.
 */
async function generate(request, { retry }) {
  try {
    return await call(request);
  } catch (err) {
    if (!retry || !isRetryable(err) || err.status === 429) throw err;
    log.warn({ model: request.model, status: err.status }, 'model busy, retrying once');
    await sleep(1500);
    return call(request);
  }
}

/**
 * Answer one question with Gemini function calling, on the first model that gets through.
 * If a model fails mid-conversation the question starts over on the next model, because
 * a model's function-calling turns (thought signatures) can't be handed to another model.
 *
 * history: [{ role: 'user' | 'model', text }] — previous turns of this chat.
 * Returns { text, toolCalls, usage, model }.
 */
export async function answer(ctx, question, history = []) {
  const models = [config.gemini.model, ...config.gemini.fallbackModels];
  let busyErr;
  let lastErr;
  for (const [i, model] of models.entries()) {
    try {
      return await answerWith(model, ctx, question, history, { retry: i === models.length - 1 });
    } catch (err) {
      lastErr = err;
      if (err.status === 404) {
        // A typo or retired model in .env shouldn't take the bot down while other models work.
        log.error({ model }, 'model not found: fix GEMINI_MODEL / GEMINI_FALLBACK_MODELS in .env');
        continue;
      }
      if (!isRetryable(err)) throw err;
      log.warn({ model, status: err.status, err: err.message?.slice(0, 200) }, 'model unavailable, trying next');
      busyErr = err;
    }
  }
  // Report "busy" over "not found" so the user gets the try-again-later reply.
  throw busyErr || lastErr;
}

async function answerWith(model, ctx, question, history, { retry }) {
  const contents = [
    ...history.map((h) => ({ role: h.role, parts: [{ text: h.text }] })),
    { role: 'user', parts: [{ text: question }] },
  ];

  const toolCalls = [];
  const usage = { input: 0, output: 0 };

  for (let round = 0; round <= config.gemini.maxToolRounds; round++) {
    const t0 = Date.now();
    const response = await generate({
      model,
      contents,
      config: {
        systemInstruction: systemPrompt(ctx),
        tools: [{ functionDeclarations: declarations }],
        temperature: 0.2,
        ...thinkingConfig,
      },
    }, { retry });
    log.info({ round, model, ms: Date.now() - t0, calls: response.functionCalls?.map((c) => c.name) ?? [] }, 'gemini round');

    usage.input += response.usageMetadata?.promptTokenCount ?? 0;
    usage.output += response.usageMetadata?.candidatesTokenCount ?? 0;

    const calls = response.functionCalls;
    if (!calls?.length) {
      return { text: response.text?.trim() || '', toolCalls, usage, model };
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

  log.warn({ model, toolCalls }, 'tool round limit reached');
  return { text: '', toolCalls, usage, model };
}
