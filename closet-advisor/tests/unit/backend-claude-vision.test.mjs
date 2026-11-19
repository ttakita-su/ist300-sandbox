// Claude photo identification (backend/claude-vision.mjs) against a fake SDK module: the request
// it sends, how answers become search words, and how every failure becomes a code. No network,
// no API key and no npm install: the real SDK is never imported here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClaudeVision, visionConfigFrom, PHOTO_MODEL, PHOTOS_PER_HOUR } from '../../backend/claude-vision.mjs';
import { fixtureImage } from '../fixtures/web/upstream.mjs';

const PHOTO = fixtureImage('/court-classic-white.jpg');
const KEY = 'sk-ant-test-not-a-real-key';

/** A stand-in for @anthropic-ai/sdk: the error classes the module checks, and a client whose create() is `handler`. */
function fakeSdk(handler) {
  class APIError extends Error {}
  class APIConnectionError extends APIError {}
  class APIConnectionTimeoutError extends APIConnectionError {}
  class AuthenticationError extends APIError {}
  class PermissionDeniedError extends APIError {}
  class RateLimitError extends APIError {}
  class BadRequestError extends APIError {}
  class NotFoundError extends APIError {}
  class InternalServerError extends APIError {}
  const clients = [];
  const requests = [];
  class Anthropic {
    constructor(options) {
      clients.push(options);
      this.beta = {
        messages: {
          create: async (body, options) => {
            requests.push({ body, options });
            return handler(body, options);
          },
        },
      };
    }
  }
  Object.assign(Anthropic, { APIError, APIConnectionError, APIConnectionTimeoutError, AuthenticationError, PermissionDeniedError, RateLimitError, BadRequestError, NotFoundError, InternalServerError });
  return { loadSdk: async () => ({ default: Anthropic }), Anthropic, clients, requests };
}

const answer = (value, stop = 'end_turn') => ({ stop_reason: stop, content: [{ type: 'text', text: JSON.stringify(value) }] });
const COURT = { found: true, brand: 'Court', name: 'Classic', color: 'White', kind: 'sneaker', search: 'Court Classic White sneaker' };

test('sends the photo once to Claude with a JSON-schema answer, and returns its search words', async () => {
  const sdk = fakeSdk(() => answer(COURT));
  const vision = createClaudeVision({ apiKey: KEY, loadSdk: sdk.loadSdk });
  const named = await vision.identify(PHOTO, 'image/jpeg', { deadline: Date.now() + 36000 });
  assert.deepEqual(named, { ok: true, query: 'Court Classic White sneaker', brand: 'Court', name: 'Classic', color: 'White', kind: 'sneaker' });

  assert.equal(sdk.requests.length, 1);
  assert.deepEqual(sdk.clients, [{ apiKey: KEY, maxRetries: 0 }], 'the key goes to the SDK client and nowhere else; the SDK never retries past the deadline');
  const { body, options } = sdk.requests[0];
  assert.equal(body.model, PHOTO_MODEL);
  assert.equal(PHOTO_MODEL, 'claude-opus-5-5');
  assert.deepEqual(body.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(body.fallbacks, 'default');
  assert.equal(body.output_config.effort, 'low');
  assert.equal(body.output_config.format.type, 'json_schema');
  assert.equal(body.output_config.format.schema.additionalProperties, false);
  assert.deepEqual(body.output_config.format.schema.required, ['found', 'brand', 'name', 'color', 'kind', 'search']);
  assert.equal('thinking' in body, false, 'thinking is left at the model default');
  assert.equal('temperature' in body, false);
  const [image, ask] = body.messages[0].content;
  assert.deepEqual(image, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: Buffer.from(PHOTO).toString('base64') } });
  assert.equal(ask.type, 'text');
  assert.equal(JSON.stringify(body).includes(KEY), false, 'the key is never part of the request body');
  assert.ok(options.timeout > 3000 && options.timeout <= 25000, 'Claude gets at most 25 s and leaves time for the Bing searches');
});

test('without its own search words the answer is brand, name and color; stray characters are dropped', async () => {
  const sdk = fakeSdk(() => answer({ found: true, brand: ' Seiko\u0007 ', name: 'Presage   Cocktail Time', color: 'Blue', kind: 'watch', search: ' ' }));
  const named = await createClaudeVision({ apiKey: KEY, loadSdk: sdk.loadSdk }).identify(PHOTO, 'image/png');
  assert.equal(named.query, 'Seiko Presage Cocktail Time Blue');
  assert.equal(named.brand, 'Seiko');
  assert.equal(sdk.requests[0].body.messages[0].content[0].source.media_type, 'image/png');

  const long = fakeSdk(() => answer({ ...COURT, search: 'x'.repeat(500) }));
  assert.equal((await createClaudeVision({ apiKey: KEY, loadSdk: long.loadSdk }).identify(PHOTO, 'image/jpeg')).query.length, 200);

  // An emoji at the 200th character is kept whole or dropped, never split into a lone surrogate.
  const emoji = fakeSdk(() => answer({ ...COURT, search: `${'a'.repeat(199)}\u{1F45F} sneaker` }));
  const clipped = (await createClaudeVision({ apiKey: KEY, loadSdk: emoji.loadSdk }).identify(PHOTO, 'image/jpeg')).query;
  assert.equal(clipped.isWellFormed(), true);
  assert.doesNotThrow(() => encodeURIComponent(clipped));
  assert.equal(Array.from(clipped).length, 200);
  const lone = fakeSdk(() => answer({ ...COURT, search: 'Court \uD83D Classic' }));
  assert.equal((await createClaudeVision({ apiKey: KEY, loadSdk: lone.loadSdk }).identify(PHOTO, 'image/jpeg')).query.isWellFormed(), true);

  const unknown = fakeSdk(() => answer({ ...COURT, kind: 'spaceship' }));
  assert.equal((await createClaudeVision({ apiKey: KEY, loadSdk: unknown.loadSdk }).identify(PHOTO, 'image/jpeg')).kind, 'other');
});

test('no item, a refusal, or nothing to search for is no_match; an unreadable answer is unavailable', async () => {
  const cases = [
    [answer({ ...COURT, found: false }), { ok: false, status: 'no_match', code: 'not_found' }],
    [{ stop_reason: 'refusal', content: [] }, { ok: false, status: 'no_match', code: 'refused' }],
    [answer({ found: true, brand: '', name: '', color: '', kind: 'other', search: '' }), { ok: false, status: 'no_match', code: 'no_query' }],
    [answer(COURT, 'max_tokens'), { ok: false, status: 'unavailable', code: 'bad_response' }],
    [{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Looks like a white sneaker.' }] }, { ok: false, status: 'unavailable', code: 'bad_response' }],
    [{ stop_reason: 'end_turn', content: [] }, { ok: false, status: 'unavailable', code: 'bad_response' }],
  ];
  for (const [reply, expected] of cases) {
    const sdk = fakeSdk(() => reply);
    assert.deepEqual(await createClaudeVision({ apiKey: KEY, loadSdk: sdk.loadSdk }).identify(PHOTO, 'image/jpeg'), expected);
  }
});

test("every API failure becomes a code, by the SDK's error class; other errors still surface", async () => {
  const probe = fakeSdk(() => null).Anthropic;
  const cases = [
    [probe.APIConnectionTimeoutError, 'timeout'],
    [probe.APIConnectionError, 'network'],
    [probe.AuthenticationError, 'key'],
    [probe.PermissionDeniedError, 'key'],
    [probe.RateLimitError, 'rate_limited'],
    [probe.BadRequestError, 'rejected'],
    [probe.NotFoundError, 'model'],
    [probe.InternalServerError, 'http_error'],
  ];
  for (const [kind, code] of cases) {
    // Each fake SDK has its own classes, so the error is made from the one the vision module loads.
    let sdk;
    sdk = fakeSdk(() => {
      throw new sdk.Anthropic[kind.name]('upstream message');
    });
    const result = await createClaudeVision({ apiKey: KEY, loadSdk: sdk.loadSdk }).identify(PHOTO, 'image/jpeg');
    assert.deepEqual(result, { ok: false, status: 'unavailable', code }, kind.name);
  }
  // A connection cut while the body is read, and a truncated body, are not bugs.
  const cut = fakeSdk(() => {
    throw new TypeError('terminated');
  });
  assert.deepEqual(await createClaudeVision({ apiKey: KEY, loadSdk: cut.loadSdk }).identify(PHOTO, 'image/jpeg'), { ok: false, status: 'unavailable', code: 'network' });
  const truncated = fakeSdk(() => {
    throw new SyntaxError('Unexpected end of JSON input');
  });
  assert.deepEqual(await createClaudeVision({ apiKey: KEY, loadSdk: truncated.loadSdk }).identify(PHOTO, 'image/jpeg'), { ok: false, status: 'unavailable', code: 'bad_response' });
  const broken = fakeSdk(() => {
    throw new TypeError('a bug, not an API answer');
  });
  await assert.rejects(createClaudeVision({ apiKey: KEY, loadSdk: broken.loadSdk }).identify(PHOTO, 'image/jpeg'), TypeError);
});

test('a missing SDK is a clear code, and is tried again on the next photo', async () => {
  let tries = 0;
  const vision = createClaudeVision({
    apiKey: KEY,
    loadSdk: async () => {
      tries += 1;
      throw new Error("Cannot find package '@anthropic-ai/sdk'");
    },
  });
  assert.deepEqual(await vision.identify(PHOTO, 'image/jpeg'), { ok: false, status: 'unavailable', code: 'sdk_missing' });
  await vision.identify(PHOTO, 'image/jpeg');
  assert.equal(tries, 2);
});

test('at most the hourly number of photos go to Claude, and too little time left sends none', async () => {
  let clock = Date.parse('2026-11-05T12:00:00Z');
  const now = () => clock;
  const sdk = fakeSdk(() => answer(COURT));
  const vision = createClaudeVision({ apiKey: KEY, loadSdk: sdk.loadSdk, now, perHour: 2 });
  assert.equal((await vision.identify(PHOTO, 'image/jpeg')).ok, true);
  assert.equal((await vision.identify(PHOTO, 'image/jpeg')).ok, true);
  assert.deepEqual(await vision.identify(PHOTO, 'image/jpeg'), { ok: false, status: 'unavailable', code: 'local_limit' });
  assert.equal(sdk.requests.length, 2, 'the third photo is not sent');
  clock += 60 * 60 * 1000;
  assert.equal((await vision.identify(PHOTO, 'image/jpeg')).ok, true, 'an hour later photos can be sent again');

  assert.deepEqual(await vision.identify(PHOTO, 'image/jpeg', { deadline: clock + 9000 }), { ok: false, status: 'unavailable', code: 'timeout' });
  assert.equal(sdk.requests.length, 3);
  assert.equal(PHOTOS_PER_HOUR, 60);
});

test('photos that arrive together while the SDK is still loading still stop at the hourly cap', async () => {
  const sdk = fakeSdk(() => answer(COURT));
  const slowLoad = async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return sdk.loadSdk();
  };
  const vision = createClaudeVision({ apiKey: KEY, loadSdk: slowLoad, perHour: 3 });
  const results = await Promise.all(Array.from({ length: 10 }, () => vision.identify(PHOTO, 'image/jpeg')));
  assert.equal(sdk.requests.length, 3);
  assert.equal(results.filter((r) => r.code === 'local_limit').length, 7);

  // A failed SDK load gives its slot back.
  let fails = true;
  const flaky = fakeSdk(() => answer(COURT));
  const retried = createClaudeVision({
    apiKey: KEY,
    perHour: 1,
    loadSdk: async () => {
      if (fails) throw new Error('not installed');
      return flaky.loadSdk();
    },
  });
  assert.equal((await retried.identify(PHOTO, 'image/jpeg')).code, 'sdk_missing');
  fails = false;
  assert.equal((await retried.identify(PHOTO, 'image/jpeg')).ok, true);
});

test('settings come from ANTHROPIC_API_KEY and an optional ANTHROPIC_PHOTO_MODEL', () => {
  assert.equal(visionConfigFrom({}), null);
  assert.equal(visionConfigFrom({ ANTHROPIC_API_KEY: '   ' }), null);
  assert.deepEqual(visionConfigFrom({ ANTHROPIC_API_KEY: ` ${KEY} ` }), { apiKey: KEY, model: PHOTO_MODEL });
  assert.deepEqual(visionConfigFrom({ ANTHROPIC_API_KEY: KEY, ANTHROPIC_PHOTO_MODEL: 'claude-haiku-5-5' }), { apiKey: KEY, model: 'claude-haiku-5-5' });
  assert.equal(visionConfigFrom({ ANTHROPIC_API_KEY: KEY, ANTHROPIC_PHOTO_MODEL: 'gpt-5; rm -rf /' }).model, PHOTO_MODEL, 'an odd model name falls back to the default');
});
