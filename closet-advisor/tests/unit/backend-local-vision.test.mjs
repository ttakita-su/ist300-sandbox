// The free photo engine (backend/local-vision.mjs): a vision model in Ollama on this computer,
// against a fake fetch. The request it sends, how answers become search words, and how every
// failure becomes a code. No network and no Ollama: fetch is replaced in each test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalVision, localVisionConfigFrom, LOCAL_PHOTO_MODEL, OLLAMA_URL } from '../../backend/local-vision.mjs';
import { fixtureImage } from '../fixtures/web/upstream.mjs';

const PHOTO = fixtureImage('/court-classic-white.jpg');
const COURT = { found: true, brand: 'Court', name: 'Classic', color: 'White', kind: 'sneaker', search: 'Court Classic White sneaker' };

/** A stand-in for fetch: records each call (with its JSON body) and answers with `handler`. */
function fakeFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : null });
    return handler(String(url), init);
  };
  return { fetchImpl, calls };
}

/** What Ollama's /api/chat answers when it isn't streaming. */
const reply = (value, extra = {}) =>
  Response.json({ model: LOCAL_PHOTO_MODEL, message: { role: 'assistant', content: typeof value === 'string' ? value : JSON.stringify(value) }, done: true, done_reason: 'stop', ...extra });

const refused = () => {
  throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11434'), { code: 'ECONNREFUSED' }) });
};

test('sends the photo to Ollama on this computer with a JSON-schema answer, and returns its search words', async () => {
  const fake = fakeFetch(() => reply(COURT));
  const vision = createLocalVision({ fetchImpl: fake.fetchImpl });
  assert.equal(vision.engine, 'local');
  assert.equal(vision.model, LOCAL_PHOTO_MODEL);
  assert.equal(LOCAL_PHOTO_MODEL, 'qwen3-vl:8b-instruct', 'the instruct model: the default qwen3-vl tag reasons at length and takes about a minute');

  const named = await vision.identify(PHOTO, 'image/jpeg', { deadline: Date.now() + 36000 });
  assert.deepEqual(named, { ok: true, query: 'Court Classic White sneaker', brand: 'Court', name: 'Classic', color: 'White', kind: 'sneaker' });

  assert.equal(fake.calls.length, 1);
  const { url, init, body } = fake.calls[0];
  assert.equal(OLLAMA_URL, 'http://127.0.0.1:11434', 'only Ollama on this computer');
  assert.equal(url, `${OLLAMA_URL}/api/chat`);
  assert.equal(init.method, 'POST');
  assert.ok(init.signal instanceof AbortSignal, 'the request is bounded by the deadline');
  assert.equal(body.model, LOCAL_PHOTO_MODEL);
  assert.equal(body.stream, false);
  assert.equal(typeof body.keep_alive, 'string', 'the model stays loaded between photos');
  assert.equal(body.options.temperature, 0);
  assert.equal(body.format.additionalProperties, false);
  assert.deepEqual(body.format.required, ['found', 'brand', 'name', 'color', 'kind', 'search']);
  const [system, user] = body.messages;
  assert.equal(system.role, 'system');
  assert.match(system.content, /Never invent a model/);
  assert.equal(user.role, 'user');
  assert.deepEqual(user.images, [Buffer.from(PHOTO).toString('base64')]);
  // Ollama enforces the answer's shape but never shows the model the schema's descriptions.
  assert.match(user.content, /found: true when the photo shows a sneaker, watch or piece of clothing/);
  assert.match(user.content, /brand: .*otherwise ""/);
});

test('a placeholder brand such as "Unknown" is dropped, and an answer without search words uses brand, name and color', async () => {
  for (const brand of ['Unknown', 'unbranded', 'N/A', 'None', 'Generic', 'Unknown brand', 'No brand', 'not visible']) {
    const fake = fakeFetch(() => reply({ found: true, brand, name: 'white leather low-top sneaker', color: 'White', kind: 'sneaker', search: ' ' }));
    const named = await createLocalVision({ fetchImpl: fake.fetchImpl }).identify(PHOTO, 'image/jpeg');
    assert.equal(named.brand, null, brand);
    assert.equal(named.query, 'white leather low-top sneaker White', brand);
  }
  const kept = fakeFetch(() => reply({ ...COURT, brand: 'Unknown Pleasures Co' }));
  assert.equal((await createLocalVision({ fetchImpl: kept.fetchImpl }).identify(PHOTO, 'image/jpeg')).brand, 'Unknown Pleasures Co', 'only a whole placeholder is dropped');

  const odd = fakeFetch(() => reply({ ...COURT, kind: 'spaceship' }));
  assert.equal((await createLocalVision({ fetchImpl: odd.fetchImpl }).identify(PHOTO, 'image/jpeg')).kind, 'other');
});

test('no item or nothing to search for is no_match; an unreadable answer is unavailable', async () => {
  const cases = [
    [() => reply({ ...COURT, found: false }), { ok: false, status: 'no_match', code: 'not_found' }],
    [() => reply({ found: true, brand: '', name: '', color: '', kind: 'other', search: '' }), { ok: false, status: 'no_match', code: 'no_query' }],
    [() => reply('Looks like a white sneaker.'), { ok: false, status: 'unavailable', code: 'bad_response' }],
    [() => Response.json({ done: true }), { ok: false, status: 'unavailable', code: 'bad_response' }],
    [() => new Response('not json at all'), { ok: false, status: 'unavailable', code: 'bad_response' }],
  ];
  for (const [handler, expected] of cases) {
    const fake = fakeFetch(handler);
    assert.deepEqual(await createLocalVision({ fetchImpl: fake.fetchImpl }).identify(PHOTO, 'image/jpeg'), expected);
  }
});

test('every failure becomes a code: not running, missing model, timeout, broken connection, error; bugs still surface', async () => {
  const cases = [
    [refused, 'not_running'],
    [() => Response.json({ error: `model '${LOCAL_PHOTO_MODEL}' not found` }, { status: 404 }), 'model'],
    [() => Response.json({ error: 'out of memory' }, { status: 500 }), 'http_error'],
    [() => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); }, 'timeout'],
    [() => { throw new TypeError('fetch failed', { cause: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }) }); }, 'network'],
    [() => new Response(new ReadableStream({ start: (c) => c.error(new TypeError('terminated')) })), 'network'],
  ];
  for (const [handler, code] of cases) {
    const fake = fakeFetch(handler);
    assert.deepEqual(await createLocalVision({ fetchImpl: fake.fetchImpl }).identify(PHOTO, 'image/jpeg'), { ok: false, status: 'unavailable', code }, code);
  }

  const late = fakeFetch(() => reply(COURT));
  assert.deepEqual(await createLocalVision({ fetchImpl: late.fetchImpl }).identify(PHOTO, 'image/jpeg', { deadline: Date.now() + 5000 }), { ok: false, status: 'unavailable', code: 'timeout' });
  assert.equal(late.calls.length, 0, 'too little time left sends nothing');

  const bug = fakeFetch(() => { throw new RangeError('a bug, not an outage'); });
  await assert.rejects(createLocalVision({ fetchImpl: bug.fetchImpl }).identify(PHOTO, 'image/jpeg'), RangeError);
});

test('warm() loads the model with no messages, and says when Ollama is not running or lacks the model', async () => {
  const loaded = fakeFetch(() => Response.json({ model: LOCAL_PHOTO_MODEL, message: { role: 'assistant', content: '' }, done: true, done_reason: 'load' }));
  assert.deepEqual(await createLocalVision({ fetchImpl: loaded.fetchImpl }).warm(), { ok: true });
  assert.equal(loaded.calls[0].url, `${OLLAMA_URL}/api/chat`);
  assert.deepEqual(loaded.calls[0].body.messages, []);
  assert.equal(loaded.calls[0].body.model, LOCAL_PHOTO_MODEL);
  assert.equal(typeof loaded.calls[0].body.keep_alive, 'string');

  assert.deepEqual(await createLocalVision({ fetchImpl: fakeFetch(refused).fetchImpl }).warm(), { ok: false, code: 'not_running' });
  const missing = fakeFetch(() => Response.json({ error: "model 'gemma3:4b' not found" }, { status: 404 }));
  assert.deepEqual(await createLocalVision({ model: 'gemma3:4b', fetchImpl: missing.fetchImpl }).warm(), { ok: false, code: 'model' });
});

test('settings come from OLLAMA_PHOTO_MODEL, which names the model; an odd name falls back to the default', () => {
  assert.equal(localVisionConfigFrom({}), null);
  assert.equal(localVisionConfigFrom({ OLLAMA_PHOTO_MODEL: '   ' }), null);
  assert.deepEqual(localVisionConfigFrom({ OLLAMA_PHOTO_MODEL: ' qwen3-vl:8b-instruct ' }), { model: 'qwen3-vl:8b-instruct' });
  assert.deepEqual(localVisionConfigFrom({ OLLAMA_PHOTO_MODEL: 'gemma3:12b' }), { model: 'gemma3:12b' });
  assert.deepEqual(localVisionConfigFrom({ OLLAMA_PHOTO_MODEL: 'library/llava' }), { model: 'library/llava' });
  assert.deepEqual(localVisionConfigFrom({ OLLAMA_PHOTO_MODEL: 'x; rm -rf /' }), { model: LOCAL_PHOTO_MODEL });
});
