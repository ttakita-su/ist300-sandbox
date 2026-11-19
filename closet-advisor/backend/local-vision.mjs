// Names the item in a photo with a vision model in Ollama on this computer, so routes.mjs can
// search Bing Shopping and the web for that name. This is the free photo search: no key, no
// account. server.mjs uses it when OLLAMA_PHOTO_MODEL is set and ANTHROPIC_API_KEY is not.
//
// The photo (the 768 px JPEG the app sends) goes only to Ollama at 127.0.0.1:11434 and is held in
// memory for this request. Only the name the model gives leaves this computer, as a Bing search.
// Ollama and the model are installed separately (README, "Free photo search on this computer").
import { ANSWER_SCHEMA, PHOTO_SYSTEM, namedFrom } from './claude-vision.mjs';

/**
 * The model used unless OLLAMA_PHOTO_MODEL names another. The instruct tag answers directly; the
 * plain qwen3-vl:8b tag reasons at length first and took about a minute per photo on an M3 Pro.
 */
export const LOCAL_PHOTO_MODEL = 'qwen3-vl:8b-instruct';
/** Ollama's own address on this computer; nothing else is asked. */
export const OLLAMA_URL = 'http://127.0.0.1:11434';

// Room left for the Bing searches after the model answers, and the most the model gets on its own
// (the browser waits 40 s for the whole photo search, and routes.mjs allows 36 s of that).
const SEARCH_RESERVE_MS = 8000;
const MAX_WAIT_MS = 28000;
// Loading the model from disk can take a while the first time.
const WARM_WAIT_MS = 60000;
// The model stays in memory between photos, so only the first photo after a pause waits for it.
const KEEP_ALIVE = '30m';
const MODEL_NAME = /^[a-z0-9][a-z0-9._-]{0,63}(?:\/[a-z0-9][a-z0-9._-]{0,63})?(?::[a-z0-9][a-z0-9._-]{0,63})?$/i;
// What a small model writes for "no brand": treated as the empty brand the prompt asks for.
const NO_BRAND = /^(?:unknown|unbranded|generic|none|n\/?a|no brand|not visible|not shown)(?: brand)?$/i;

// Ollama makes the answer fit ANSWER_SCHEMA (format) but never shows the model its descriptions,
// so the meaning of each field is spelled out here.
const ASK = `What is the main item in this photo? Answer in JSON with these fields:
- found: true when the photo shows a sneaker, watch or piece of clothing, even when you can't tell its brand or model; false only when it shows none of these.
- brand: the brand, only when a logo, label or unmistakable design in the photo shows it; otherwise "".
- name: the model or product name when you recognize it; otherwise a plain description, such as "white leather low-top sneaker".
- color: the main color or colorway, or "".
- kind: "sneaker", "watch", "clothing" or "other".
- search: at most 12 words a shopper would type to find this item in an online store.`;

/**
 * The local photo search settings from the environment, or null when OLLAMA_PHOTO_MODEL is unset.
 * @param {Record<string, string|undefined>} env process.env, or a test's own object
 * @returns {{ model: string } | null}
 */
export function localVisionConfigFrom(env) {
  const asked = String(env.OLLAMA_PHOTO_MODEL ?? '').trim();
  if (!asked) return null;
  return { model: MODEL_NAME.test(asked) ? asked : LOCAL_PHOTO_MODEL };
}

// Why a request to Ollama failed, as a code. Anything else is a bug and surfaces.
function failure(error) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'timeout';
  if (error instanceof SyntaxError) return 'bad_response';
  if (error instanceof TypeError && error.cause?.code === 'ECONNREFUSED') return 'not_running';
  // A connection cut before or during the answer (Ollama stopped or crashed).
  if (error instanceof TypeError && (error.message === 'fetch failed' || error.message === 'terminated')) return 'network';
  throw error;
}

/**
 * Photo identification with a vision model in Ollama on this computer.
 * @param {{ model?: string, now?: () => number, fetchImpl?: typeof fetch }} [options] fetchImpl: tests pass a fake
 * @returns {{ engine: 'local', model: string,
 *   identify(bytes: Uint8Array, mime: string, opts?: { deadline?: number }): Promise<
 *     { ok: true, query: string, brand: string|null, name: string|null, color: string|null, kind: string }
 *     | { ok: false, status: 'no_match' | 'unavailable', code: string }>,
 *   warm(): Promise<{ ok: true } | { ok: false, code: string }> }}
 *   warm loads the model ahead of the first photo; server.mjs calls it at startup
 */
export function createLocalVision({ model = LOCAL_PHOTO_MODEL, now = Date.now, fetchImpl = fetch } = {}) {
  // One request to /api/chat: Ollama's parsed answer, or a failure code.
  async function chat(body, timeoutMs) {
    try {
      const response = await fetchImpl(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status === 404) return { code: 'model' };
      if (!response.ok) return { code: 'http_error' };
      return { reply: await response.json() };
    } catch (error) {
      return { code: failure(error) };
    }
  }

  // The image's type isn't sent: Ollama reads it from the bytes.
  async function identify(bytes, _mime, { deadline = now() + 36000 } = {}) {
    const wait = Math.min(MAX_WAIT_MS, deadline - now() - SEARCH_RESERVE_MS);
    if (wait < 3000) return { ok: false, status: 'unavailable', code: 'timeout' };
    const sent = await chat(
      {
        model,
        stream: false,
        keep_alive: KEEP_ALIVE,
        format: ANSWER_SCHEMA,
        options: { temperature: 0 },
        messages: [
          { role: 'system', content: PHOTO_SYSTEM },
          { role: 'user', content: ASK, images: [Buffer.from(bytes).toString('base64')] },
        ],
      },
      wait,
    );
    if (sent.code) return { ok: false, status: 'unavailable', code: sent.code };
    let answer;
    try {
      answer = JSON.parse(sent.reply?.message?.content);
    } catch {
      return { ok: false, status: 'unavailable', code: 'bad_response' };
    }
    if (typeof answer?.brand === 'string' && NO_BRAND.test(answer.brand.trim())) answer = { ...answer, brand: '' };
    return namedFrom(answer);
  }

  async function warm() {
    const sent = await chat({ model, messages: [], keep_alive: KEEP_ALIVE }, WARM_WAIT_MS);
    return sent.code ? { ok: false, code: sent.code } : { ok: true };
  }

  return { engine: 'local', model, identify, warm };
}
