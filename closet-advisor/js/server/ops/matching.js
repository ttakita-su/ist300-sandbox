// Photo-to-product matching jobs (ARCHITECTURE.md 4.3 matchJob). A job analyzes one photo in
// the background, keeps every status transition in the store, and never turns a candidate
// into an item: only confirmMatch does that, with the person's choice recorded as theirs.
import { ApiError, notFound, invalid } from '../errors.js';
import { newId, hashString } from '../../lib/ids.js';
import { buildIndex, match, findIdentifiers } from '../../engine/matcher.js';
import { FEATURES_VERSION } from '../../engine/features.js';
import { findDuplicates } from '../../engine/duplicates.js';
import { ILLUSTRATION_VERSION, specFor } from '../../data/illustrations.js';
import { CATEGORIES } from '../../data/schema.js';
import { buildOwnedItem, buildWishlistItem, makeIdentity, iso } from '../records.js';
import { ownedView, wishlistView, productSummary, variantView, copyCounts } from '../views.js';

/** Runs per job before retry is refused (a new label photo or code starts a fresh count). */
export const MAX_ATTEMPTS = 3;

const OCR_UNAVAILABLE = "Label reading needs a connection the first time it's used. Type the code instead.";
const OCR_OFF = 'Label reading is switched off right now. Type the code instead.';
const MAX_TEXTS = 12;
const MAX_TEXT_LENGTH = 500;

const perfNow = () => globalThis.performance?.now?.() ?? Date.now();

// ---------- Reference index (cached features of every catalog render) ----------

const indexByCatalog = new WeakMap();

/** catalogFeatures row id: one row per variant and illustration generator version. */
export function referenceKey(variantId) {
  return `${variantId}:${ILLUSTRATION_VERSION}`;
}

/** Changes when the variant's drawing input or the feature extractor changes. */
function specHash(catalog, variant) {
  const product = catalog.product(variant.productId);
  return hashString(`${FEATURES_VERSION}:${JSON.stringify(specFor(product, variant))}`).toString(36);
}

/**
 * The matcher index over reference features. Features come from the 'catalogFeatures' store
 * when present and current; only missing or stale variants are rendered, then stored, so the
 * first scan builds the index once and later scans start immediately.
 * @param {{ db: any, providers: any, catalog: any, now?: number,
 *   onProgress?: (p: { stage: string, done: number, total: number }) => void }} env
 */
export function loadReferenceIndex(env) {
  const { db, providers, catalog } = env;
  const cached = indexByCatalog.get(catalog);
  if (cached) return cached;
  const promise = (async () => {
    const rows = await db.all('catalogFeatures');
    const stored = new Map(rows.map((r) => [r.id, r]));
    const features = new Map();
    const missing = [];
    for (const variant of catalog.listVariants()) {
      const row = stored.get(referenceKey(variant.id));
      if (row && row.specHash === specHash(catalog, variant) && row.features?.v === FEATURES_VERSION) features.set(variant.id, row.features);
      else missing.push(variant.id);
    }
    if (missing.length) {
      env.onProgress?.({ stage: 'indexing', done: 0, total: missing.length });
      const computed = await providers.reference.features(catalog, missing, {
        onProgress: (done, total) => env.onProgress?.({ stage: 'indexing', done, total }),
      });
      const createdAt = new Date(env.now ?? Date.now()).toISOString();
      const fresh = [];
      for (const id of missing) {
        const f = computed?.get?.(id);
        const variant = catalog.variant(id);
        if (!f || !variant) continue;
        features.set(id, f);
        fresh.push({ id: referenceKey(id), variantId: id, illustrationVersion: ILLUSTRATION_VERSION, featuresVersion: FEATURES_VERSION, specHash: specHash(catalog, variant), features: f, createdAt });
      }
      if (fresh.length) await db.bulkPut('catalogFeatures', fresh);
    }
    return buildIndex(catalog, features);
  })();
  indexByCatalog.set(catalog, promise);
  // A failed build is not cached, so the next job tries again.
  promise.catch(() => indexByCatalog.delete(catalog));
  return promise;
}

/**
 * The analysis step shared by match jobs and the synthetic evaluation: features from the
 * processing copy, then the matcher. Provider simulation applies here so an admin can show
 * the failure states.
 * @param {{ providers: any, index: any, blob: Blob, crop?: any, category?: string|null,
 *   texts?: any[], productUrl?: string|null, link?: any, simulation?: any }} input
 */
export async function analyzeAndMatch(input) {
  const { providers, index, blob, crop = null, category = null, texts = [], productUrl = null, link = null, simulation = {} } = input;
  if (simulation?.vision === 'error') throw new ApiError('unavailable', 'Photo analysis failed. Try again.');
  // A hung provider: never resolves, so the job's timeout decides.
  if (simulation?.vision === 'timeout') await new Promise(() => {});
  const started = perfNow();
  const features = await providers.vision.analyze({ blob, crop, category });
  const result = match(index, { features, category, texts, productUrl }, { link });
  result.latencyMs = Math.round(perfNow() - started);
  return { features, result };
}

// ---------- Job storage ----------

const locks = new WeakMap();

/** Serializes read-modify-write of one job so background progress can't overwrite a newer state. */
async function updateJob(db, jobId, mutate) {
  if (!locks.has(db)) locks.set(db, new Map());
  const table = locks.get(db);
  const prev = table.get(jobId) ?? Promise.resolve();
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const chained = prev.then(() => gate);
  table.set(jobId, chained);
  await prev;
  try {
    const job = await db.get('matchJobs', jobId);
    if (!job) return null;
    const next = await mutate(job);
    if (!next) return job;
    await db.put('matchJobs', next);
    return next;
  } finally {
    release();
    if (table.get(jobId) === chained) table.delete(jobId);
  }
}

async function ownJob(ctx, jobId) {
  const job = typeof jobId === 'string' && jobId ? await ctx.db.get('matchJobs', jobId) : null;
  // Another person's job looks exactly like a missing one, so ids can't be probed.
  if (!job || job.userId !== ctx.actor.id) throw notFound('That match');
  return job;
}

async function ownPhoto(ctx, photoId) {
  const photo = typeof photoId === 'string' && photoId ? await ctx.db.get('photos', photoId) : null;
  if (!photo || photo.userId !== ctx.actor.id) throw notFound('That photo');
  return photo;
}

/** The processing copy stored next to an original (see ops/photos.js uploadPhoto). */
async function processingCopy(ctx, photo, processingId) {
  if (processingId) {
    const p = await ownPhoto(ctx, processingId);
    return p.id;
  }
  if (photo.kind === 'processing') return photo.id;
  if (photo.processingId) {
    const p = await ctx.db.get('photos', photo.processingId);
    if (p && p.userId === photo.userId) return p.id;
  }
  const mine = await ctx.db.where('photos', 'userId', photo.userId);
  const linked = mine.find((p) => p.kind === 'processing' && [p.originalId, p.sourceId, p.parentId].includes(photo.id));
  return linked?.id ?? null;
}

function cleanCrop(crop) {
  if (crop == null) return null;
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
  const x = num(crop.x);
  const y = num(crop.y);
  const w = num(crop.w);
  const h = num(crop.h);
  const rotate = crop.rotate == null ? 0 : Number(crop.rotate);
  const ok = [x, y, w, h].every((v) => v >= 0 && v <= 1) && w >= 0.02 && h >= 0.02 && x + w <= 1.0001 && y + h <= 1.0001 && [0, 90, 180, 270].includes(rotate);
  if (!ok) throw invalid({ crop: 'Adjust the crop so it stays inside the photo' }, 'The crop is outside the photo. Adjust it and try again.');
  return { x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y), rotate };
}

function cleanTexts(texts, now) {
  if (texts == null) return [];
  if (!Array.isArray(texts)) throw invalid({ texts: 'Codes must be a list' });
  return texts
    .filter((t) => t && typeof t.text === 'string' && t.text.trim())
    .slice(0, MAX_TEXTS)
    .map((t) => ({
      text: t.text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, MAX_TEXT_LENGTH),
      source: ['ocr', 'barcode', 'user_entered'].includes(t.source) ? t.source : 'user_entered',
      at: iso(now),
    }));
}

/** What screens get: the job plus product and version views for every candidate. */
export function jobView(catalog, job, now) {
  const { runId: _run, ...rest } = job;
  const view = {
    ...rest,
    maxAttempts: MAX_ATTEMPTS,
    canRetry: (job.status === 'error' || job.status === 'timeout') && job.attempts < MAX_ATTEMPTS,
  };
  if (job.result) {
    view.result = {
      ...job.result,
      candidates: job.result.candidates
        .map((c) => {
          const product = catalog.product(c.productId);
          if (!product) return null;
          return {
            ...c,
            product: productSummary(catalog, product),
            variants: c.variantOptions
              .map((o) => catalog.variant(o.variantId))
              .filter(Boolean)
              .map((v) => variantView(catalog, v, { now, context: 'product' })),
          };
        })
        .filter(Boolean),
    };
  }
  return view;
}

// ---------- Background runner ----------

function runnerEnv(ctx) {
  return { db: ctx.db, providers: ctx.providers, config: ctx.config, clock: ctx.clock, catalog: ctx.catalog, metric: ctx.metric };
}

function schedule(env, jobId, runId) {
  setTimeout(() => {
    runJob(env, jobId, runId).catch((error) => console.error('[matching] job runner failed', error));
  }, 0);
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new ApiError('timeout', 'Matching took too long. Try again.')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function readLabels(env, job, simulation, setStage) {
  const texts = [...(job.texts ?? [])];
  const reads = [...(job.labelReads ?? [])];
  const pending = (job.labelPhotoIds ?? []).filter((id) => !reads.some((r) => r.photoId === id && r.status !== 'error'));
  for (const photoId of pending) {
    await setStage('reading_label');
    const at = iso(env.clock.now());
    if (simulation?.ocr === 'off') {
      reads.push({ photoId, status: 'unavailable', message: OCR_OFF, at });
      continue;
    }
    const photo = await env.db.get('photos', photoId);
    if (!photo?.blob) {
      reads.push({ photoId, status: 'error', message: 'The label photo is no longer available.', at });
      continue;
    }
    try {
      const out = await env.providers.ocr.read(photo.blob);
      const text = String(out?.text ?? '').trim().slice(0, 2000);
      if (text) texts.push({ text, source: 'ocr', at, photoId, confidence: out.confidence ?? null });
      for (const digits of out?.barcodes ?? []) texts.push({ text: String(digits), source: 'barcode', at, photoId, confidence: null });
      reads.push({ photoId, status: text || out?.barcodes?.length ? 'read' : 'empty', message: text || out?.barcodes?.length ? null : 'No text could be read from the label photo. Try a closer, sharper photo or type the code.', at });
    } catch (error) {
      const unavailable = error?.code === 'unavailable';
      reads.push({ photoId, status: unavailable ? 'unavailable' : 'error', message: unavailable ? error.message || OCR_UNAVAILABLE : 'The label could not be read. Type the code instead.', at });
    }
  }
  return { texts, reads };
}

async function runJob(env, jobId, runId) {
  const { db } = env;
  const isCurrent = (job) => job && job.runId === runId;
  const started = perfNow();
  const begun = await updateJob(db, jobId, (job) =>
    isCurrent(job) && job.status === 'queued'
      ? { ...job, status: 'processing', attempts: (job.attempts ?? 0) + 1, updatedAt: iso(env.clock.now()), progress: { stage: 'preparing', done: 0, total: 0 } }
      : null,
  );
  if (!isCurrent(begun) || begun.status !== 'processing') return;

  let lastWrite = 0;
  const setProgress = async (progress, force = false) => {
    const t = perfNow();
    if (!force && t - lastWrite < 150) return;
    lastWrite = t;
    await updateJob(db, jobId, (job) => (isCurrent(job) && job.status === 'processing' ? { ...job, progress } : null));
  };
  const setStage = (stage) => setProgress({ stage, done: 0, total: 0 }, true);

  const config = env.config;
  const simulation = (await config.get('providerSimulation')) ?? {};
  const timeoutMs = Number(await config.get('matchTimeoutMs')) || 15000;
  try {
    const catalog = await env.catalog();
    const index = await loadReferenceIndex({
      db,
      providers: env.providers,
      catalog,
      now: env.clock.now(),
      onProgress: (p) => {
        setProgress(p, p.done === 0 || p.done === p.total);
      },
    });
    const { texts, reads } = await readLabels(env, begun, simulation, setStage);
    await setStage('analyzing');
    const photo = (begun.processingId && (await db.get('photos', begun.processingId))) || (await db.get('photos', begun.photoId));
    if (!photo?.blob) throw new ApiError('not_found', 'The photo for this match is no longer available. Take or choose the photo again.');
    const { result } = await withTimeout(
      analyzeAndMatch({ providers: env.providers, index, blob: photo.blob, crop: begun.crop, category: begun.category, texts, productUrl: begun.productUrl, link: begun.link, simulation }),
      timeoutMs,
    );
    for (const r of reads) if (r.status === 'unavailable' && r.message) result.notes = [...new Set([...(result.notes ?? []), r.message])];
    if (begun.link && begun.link.status !== 'resolved' && begun.link.reason) result.notes = [...new Set([...(result.notes ?? []), begun.link.reason])];
    const latencyMs = Math.round(perfNow() - started);
    result.latencyMs = latencyMs;
    const saved = await updateJob(db, jobId, (job) =>
      isCurrent(job) && job.status === 'processing'
        ? { ...job, status: 'done', texts, labelReads: reads, result, error: null, latencyMs, progress: null, updatedAt: iso(env.clock.now()) }
        : null,
    );
    if (isCurrent(saved) && saved.status === 'done') {
      const lead = result.candidates[0];
      await env.metric('match_done', {
        category: begun.category,
        dest: begun.dest,
        retrieval: result.retrieval,
        latencyMs,
        attempts: saved.attempts,
        candidates: result.candidates.length,
        variantAmbiguous: Boolean(lead?.variantAmbiguous),
        evidence: [...new Set((lead?.evidence ?? []).map((e) => e.kind))],
      });
    }
  } catch (error) {
    const timedOut = error?.code === 'timeout';
    if (!(error instanceof ApiError)) console.error('[matching] analysis failed', error);
    const failure = timedOut
      ? { code: 'timeout', message: 'Matching took too long. Try again.' }
      : { code: error instanceof ApiError ? error.code : 'unavailable', message: error instanceof ApiError ? error.message : 'Matching failed. Try again.' };
    const latencyMs = Math.round(perfNow() - started);
    const saved = await updateJob(db, jobId, (job) =>
      isCurrent(job) && job.status === 'processing'
        ? { ...job, status: timedOut ? 'timeout' : 'error', error: failure, latencyMs, progress: null, updatedAt: iso(env.clock.now()) }
        : null,
    );
    if (isCurrent(saved)) await env.metric('match_failed', { category: begun.category, code: failure.code, attempts: saved.attempts, latencyMs });
  }
}

/** Puts a job back in the queue with a fresh run id and starts it. */
async function requeue(env, jobId, patch = {}) {
  const runId = newId('run');
  const next = await updateJob(env.db, jobId, (job) => ({
    ...job,
    ...patch,
    status: 'queued',
    error: null,
    progress: { stage: 'queued', done: 0, total: 0 },
    runId,
    updatedAt: iso(env.clock.now()),
  }));
  schedule(env, jobId, runId);
  return next;
}

/**
 * Admin retry (ops/admin.js adminRetryJob). Re-queues a job that ended in 'error' or
 * 'timeout' without an ownership check; the same attempt limit applies.
 * @returns {Promise<{ id: string, status: string, attempts: number }>}
 */
export async function requeueMatchJob(ctx, jobId) {
  const job = typeof jobId === 'string' ? await ctx.db.get('matchJobs', jobId) : null;
  if (!job) throw notFound('That match job');
  if (job.status !== 'error' && job.status !== 'timeout') throw new ApiError('conflict', 'Only a job that failed or timed out can be retried.');
  if (job.attempts >= MAX_ATTEMPTS) throw new ApiError('conflict', `This job already ran ${MAX_ATTEMPTS} times. The person can add a label photo or code to start again.`);
  const next = await requeue(runnerEnv(ctx), jobId);
  return { id: next.id, status: next.status, attempts: next.attempts };
}

// ---------- Confirmation ----------

const WORD = { style_code: 'style code', reference: 'reference', gtin: 'barcode' };
const FROM = { ocr: 'read from your label photo', barcode: 'scanned from your barcode photo', user_entered: 'that you typed' };

function identityFor({ job, index, productId, variantId, variantUnsure, candidate, picked, actorId, now }) {
  const retrieval = job.result?.retrieval ?? (job.status === 'error' || job.status === 'timeout' ? 'processing_error' : 'not_run');
  const variantName = (id) => index.byVariant.get(id)?.variantName ?? 'another version';
  const productName = (id) => {
    const p = index.products.get(id);
    return p ? `the ${p.brandName} ${p.name}` : 'another product';
  };
  const { hits } = findIdentifiers(index, job.texts ?? []);
  const firm = hits.filter((h) => h.exactness !== 'near');
  const supports = variantId ? firm.filter((h) => h.variantId === variantId) : [];
  const against = firm.filter((h) => h.productId !== productId || (variantId && h.variantId !== variantId));

  const evidence = [];
  const conflicts = [...(candidate?.conflicts ?? [])];
  for (const h of supports) {
    evidence.push({ kind: 'identifier', source: h.source, detail: `${WORD[h.kind].charAt(0).toUpperCase()}${WORD[h.kind].slice(1)} ${h.code} ${FROM[h.source] ?? ''} matches this version`.replace(/\s+/g, ' ') });
  }
  for (const h of against) {
    const belongs = h.productId !== productId ? productName(h.productId) : variantName(h.variantId);
    const detail = `The ${WORD[h.kind]} ${h.code} ${FROM[h.source] ?? ''} belongs to ${belongs}, not the version you chose`.replace(/\s+/g, ' ');
    if (!conflicts.some((c) => c.detail === detail)) conflicts.push({ kind: 'identifier', detail });
  }
  // Supporting evidence the matcher found, minus identifier lines (restated above for the
  // chosen version) and lines about other versions.
  for (const e of candidate?.evidence ?? []) {
    if (e.kind === 'identifier') continue;
    evidence.push(e);
  }
  const link = job.link?.status === 'resolved' ? job.link : null;
  if (link) {
    if (link.productId !== productId || (variantId && link.variantId && link.variantId !== variantId)) {
      conflicts.push({ kind: 'product_link', detail: `Your product link is for ${link.productId !== productId ? productName(link.productId) : variantName(link.variantId)}, not the version you chose` });
    } else if (!evidence.some((e) => e.kind === 'product_link')) {
      evidence.push({ kind: 'product_link', source: 'url', detail: 'The product link you added is for this product' });
    }
  }
  const versionPart = variantUnsure ? "you weren't sure which version it is" : variantId ? `you chose ${variantName(variantId)}` : 'you did not choose a version';
  if (picked === 'search') {
    evidence.push({ kind: 'catalog_search', source: 'catalog', detail: `You chose this product from catalog search, and ${versionPart}` });
  } else if (candidate?.kind === 'similar') {
    evidence.push({ kind: 'user_selection', source: 'user_entered', detail: `You chose this from similar products (the photo alone was not a confident match), and ${versionPart}` });
  } else {
    evidence.push({ kind: 'user_selection', source: 'user_entered', detail: `You confirmed this match, and ${versionPart}` });
  }

  const linkAgainst = conflicts.some((c) => c.kind === 'product_link');
  return makeIdentity({
    retrieval,
    resolution: supports.length ? 'identifier_supported' : 'user_confirmed',
    variant: against.length || linkAgainst ? 'conflicting' : !variantId || variantUnsure ? 'incomplete' : 'confirmed',
    evidence,
    conflicts,
    confirmedBy: actorId,
    confirmedAt: iso(now),
    matchJobId: job.id,
  });
}

// ---------- Operations ----------

export const ops = {
  /**
   * Starts a match job for one item in one photo. Rate limit: 'scan'.
   * args: { photoId, category, dest: 'owned'|'wishlist', crop?: {x,y,w,h,rotate}, texts?: [{text, source}],
   *         processingId?, idempotencyKey }
   * - The photo must belong to the actor. The processing copy is found from processingId, the
   *   original's processingId field, or a processing row linked by originalId.
   * - Stores a matchJob (status 'queued') and runs it in the background: 'processing' ->
   *   reference index (built once, progress in job.progress) -> OCR of label photos ->
   *   vision.analyze -> matcher.match -> 'done' with result, or 'error' / 'timeout'
   *   (config.matchTimeoutMs, providerSimulation.vision). Bounded: attempts <= 3.
   * - Records metrics: match latency, retrieval status, category (no user ids).
   * result: matchJob view (see getMatchJob)
   */
  createMatchJob: {
    auth: 'user',
    idempotent: true,
    rateLimit: 'scan',
    async run(ctx, args) {
      const dest = args.dest ?? 'owned';
      if (!['owned', 'wishlist'].includes(dest)) throw invalid({ dest: 'Choose collection or wishlist' });
      const category = args.category ?? null;
      if (category !== null && !CATEGORIES.includes(category)) throw invalid({ category: 'Choose sneakers, a watch or clothing' });
      const crop = cleanCrop(args.crop);
      const photo = await ownPhoto(ctx, args.photoId);
      const processingId = await processingCopy(ctx, photo, args.processingId);
      const now = ctx.now();
      const job = {
        id: newId('job'),
        userId: ctx.actor.id,
        createdAt: iso(now),
        updatedAt: iso(now),
        dest,
        category,
        photoId: photo.id,
        processingId,
        crop,
        labelPhotoIds: [],
        texts: cleanTexts(args.texts, now),
        labelReads: [],
        productUrl: null,
        link: null,
        status: 'queued',
        attempts: 0,
        error: null,
        latencyMs: null,
        progress: { stage: 'queued', done: 0, total: 0 },
        result: null,
        confirmedItemId: null,
        runId: newId('run'),
      };
      await ctx.db.put('matchJobs', job);
      await ctx.metric('match_started', { category, dest, hasCrop: Boolean(crop), hasText: job.texts.length > 0 });
      schedule(runnerEnv(ctx), job.id, job.runId);
      return jobView(await ctx.catalog(), job, now);
    },
  },

  /**
   * args: { jobId } -> matchJob view (owner only; others get not_found). Each result candidate
   * carries `product` (productSummary) and `variants` (variantView per variantOption, same
   * order, with image url). Also: progress { stage, done, total } while running, labelReads,
   * link (resolved product URL), canRetry and maxAttempts.
   */
  getMatchJob: {
    auth: 'user',
    async run(ctx, { jobId }) {
      const job = await ownJob(ctx, jobId);
      return jobView(await ctx.catalog(), job, ctx.now());
    },
  },

  /**
   * Adds evidence and re-runs matching: a label/size-tag/case-back photo, a typed code, or a
   * product URL. args: { jobId, labelPhotoId?, code?, productUrl?, idempotencyKey }
   * Typed codes are recorded with source 'user_entered'; OCR text with source 'ocr'. A product
   * URL is resolved with importFromUrl (commerce); if that is unavailable the job still runs.
   * New evidence starts a fresh attempt count.
   * result: matchJob view (re-queued)
   */
  addMatchEvidence: {
    auth: 'user',
    idempotent: true,
    rateLimit: 'scan',
    async run(ctx, args) {
      const job = await ownJob(ctx, args.jobId);
      if (job.status === 'confirmed') throw new ApiError('conflict', 'This match was already saved. Open the item to change it.');
      const now = ctx.now();
      const patch = {};
      const kinds = [];
      if (args.labelPhotoId != null) {
        const label = await ownPhoto(ctx, args.labelPhotoId);
        patch.labelPhotoIds = [...new Set([...(job.labelPhotoIds ?? []), label.id])];
        // A replaced label photo is read again.
        patch.labelReads = (job.labelReads ?? []).filter((r) => r.photoId !== label.id);
        patch.texts = (job.texts ?? []).filter((t) => t.photoId !== label.id);
        kinds.push('label_photo');
      }
      if (args.code != null) {
        const code = String(args.code).trim();
        if (!code) throw invalid({ code: 'Enter the code from the label' });
        if (code.length > 64) throw invalid({ code: 'That code is too long. Enter just the code from the label' });
        const texts = patch.texts ?? job.texts ?? [];
        patch.texts = [...texts, ...cleanTexts([{ text: code, source: 'user_entered' }], now)].slice(-MAX_TEXTS);
        kinds.push('code');
      }
      if (args.productUrl != null) {
        const url = String(args.productUrl).trim();
        if (!url || url.length > 2048) throw invalid({ productUrl: 'Paste a link to the product page' });
        patch.productUrl = url;
        patch.link = await resolveLink(ctx, url);
        kinds.push('product_link');
      }
      if (!kinds.length) throw invalid({ code: 'Add a label photo, a code or a product link' }, 'Add a label photo, a code or a product link.');
      const next = await requeue(runnerEnv(ctx), job.id, { ...patch, attempts: 0, result: null });
      for (const kind of kinds) await ctx.metric('match_evidence', { kind, category: job.category });
      return jobView(await ctx.catalog(), next, now);
    },
  },

  /** Re-runs a job that ended in 'error' or 'timeout'. args: { jobId, idempotencyKey } */
  retryMatchJob: {
    auth: 'user',
    idempotent: true,
    rateLimit: 'scan',
    async run(ctx, { jobId }) {
      const job = await ownJob(ctx, jobId);
      if (job.status !== 'error' && job.status !== 'timeout') throw new ApiError('conflict', 'Only a match that failed or timed out can be tried again.');
      if (job.attempts >= MAX_ATTEMPTS) {
        throw new ApiError('conflict', `This photo couldn't be matched after ${MAX_ATTEMPTS} tries. Add a label photo or type the code, or save the item yourself.`);
      }
      const next = await requeue(runnerEnv(ctx), job.id);
      await ctx.metric('match_retry', { category: job.category, attempts: job.attempts });
      return jobView(await ctx.catalog(), next, ctx.now());
    },
  },

  /** The person says none of the candidates is right. args: { jobId } -> matchJob ('rejected') */
  rejectMatch: {
    auth: 'user',
    async run(ctx, { jobId }) {
      const job = await ownJob(ctx, jobId);
      if (job.status === 'confirmed') throw new ApiError('conflict', 'This match was already saved. Open the item to change it.');
      const next = await updateJob(ctx.db, job.id, (j) => ({ ...j, status: 'rejected', progress: null, runId: newId('run'), updatedAt: iso(ctx.now()) }));
      await ctx.metric('match_rejected', { category: job.category, retrieval: job.result?.retrieval ?? 'not_run' });
      return jobView(await ctx.catalog(), next, ctx.now());
    },
  },

  /**
   * Saves the confirmed item. Confirmation is required; a candidate never becomes an identity
   * without this call.
   * args: { jobId, candidateId | null, variantId | null, variantUnsure?: boolean,
   *         custom?: { brand, name, variantName?, type?, colors? } (saving without a catalog match),
   *         category? (custom saves when the job has none),
   *         details?: {...} (owned) | wish?: { reason, reasonNote, intent, desired, targetPriceMinor },
   *         display?: 'catalog'|'original', allowDuplicate?: boolean, idempotencyKey }
   * - candidateId null with a variantId: a version picked from catalog search.
   * - Identity: retrieval from the job; resolution 'identifier_supported' only when an
   *   identifier in job.texts matches the chosen variant, else 'user_confirmed'; 'manual' when
   *   saving a custom item. Variant: 'confirmed' | 'incomplete' (variantUnsure or none chosen) |
   *   'conflicting' (an identifier or product link points to a different variant).
   *   Evidence lists what supported it and where it came from; confirmedBy = actor.
   * - Duplicate check (engine/duplicates.js) unless allowDuplicate -> ApiError('duplicate',
   *   ..., { duplicates: [OwnedView] }) (wishlist: [WishlistView]).
   * - The original photo is attached (photos.originalId) and kept even when display is 'catalog'.
   * result: { item: OwnedView | WishlistView, job }
   */
  confirmMatch: {
    auth: 'user',
    idempotent: true,
    async run(ctx, args) {
      const job = await ownJob(ctx, args.jobId);
      if (job.status === 'confirmed') throw new ApiError('conflict', 'This match was already saved. Open the item to change it.', { itemId: job.confirmedItemId });
      if (job.status === 'queued' || job.status === 'processing') throw new ApiError('conflict', 'Matching is still running. Wait for the results, then confirm.');
      const catalog = await ctx.catalog();
      const index = buildIndex(catalog);
      const now = ctx.now();
      const actorId = ctx.actor.id;

      let productId = null;
      let variantId = args.variantId ?? null;
      let candidate = null;
      let picked = null;
      if (args.candidateId) {
        if (job.status === 'rejected') throw new ApiError('conflict', 'You marked these matches as wrong. Add a code or label photo to match again, or save the item yourself.');
        candidate = job.result?.candidates?.find((c) => c.id === args.candidateId) ?? null;
        if (!candidate) throw invalid({ candidateId: 'Choose one of the matches shown' }, 'That match is not part of these results. Choose one of the matches shown.');
        productId = candidate.productId;
        picked = 'candidate';
      } else if (variantId) {
        const variant = catalog.variant(variantId);
        if (!variant) throw invalid({ variantId: 'That version is not in the catalog' });
        productId = variant.productId;
        picked = 'search';
      }
      if (variantId) {
        const variant = catalog.variant(variantId);
        if (!variant || variant.productId !== productId) throw invalid({ variantId: 'That version does not belong to this product' });
      }

      let input;
      if (productId) {
        const product = catalog.product(productId);
        if (!product) throw invalid({ candidateId: 'That product is no longer in the catalog' });
        const identity = identityFor({ job, index, productId, variantId, variantUnsure: Boolean(args.variantUnsure), candidate, picked, actorId, now });
        input = { category: product.category, productId, variantId, identity };
      } else {
        if (!args.custom) throw invalid({ candidateId: 'Choose a match, a version from search, or save it as your own item' }, 'Choose a match, or save it as your own item.');
        const category = args.category ?? job.category;
        input = {
          category,
          productId: null,
          variantId: null,
          custom: args.custom,
          identity: makeIdentity({
            retrieval: job.result?.retrieval ?? (job.status === 'error' || job.status === 'timeout' ? 'processing_error' : 'not_run'),
            resolution: 'manual',
            variant: 'not_applicable',
            evidence: [{ kind: 'user_selection', source: 'user_entered', detail: 'Saved as your own item without a catalog match' }],
            confirmedBy: actorId,
            confirmedAt: iso(now),
            matchJobId: job.id,
          }),
        };
        variantId = null;
      }

      const env = { userId: actorId, now, catalog };
      let item;
      let view;
      if (job.dest === 'wishlist') {
        const wish = args.wish ?? {};
        item = buildWishlistItem({ ...wish, ...input, photos: { originalId: job.photoId }, sourceUrl: job.productUrl ?? null }, env);
        const mine = await ctx.db.where('wishlistItems', 'userId', actorId);
        const dups = findDuplicates(mine, item);
        if (dups.length && !args.allowDuplicate) {
          throw new ApiError('duplicate', 'This is already on your wishlist.', { duplicates: dups.map((d) => wishlistView(catalog, d, { now })) });
        }
        await ctx.db.put('wishlistItems', item);
        view = wishlistView(catalog, item, { now });
      } else {
        const display = args.display === 'original' ? 'original' : input.productId && input.variantId ? 'catalog' : 'original';
        item = buildOwnedItem(
          { ...input, details: args.details, photos: { originalId: job.photoId, cleanedId: null, labelIds: job.labelPhotoIds ?? [] }, display: args.display ?? display },
          env,
        );
        const mine = await ctx.db.where('ownedItems', 'userId', actorId);
        const dups = findDuplicates(mine, item);
        if (dups.length && !args.allowDuplicate) {
          const counts = copyCounts(mine);
          throw new ApiError('duplicate', 'You already have this in your collection.', {
            duplicates: dups.map((d) => ownedView(catalog, d, { now, copies: counts.get(d.variantId) ?? 1 })),
          });
        }
        await ctx.db.put('ownedItems', item);
        const counts = copyCounts([...mine, item]);
        view = ownedView(catalog, item, { now, copies: counts.get(item.variantId) ?? 1 });
      }

      const saved = await updateJob(ctx.db, job.id, (j) => ({ ...j, status: 'confirmed', confirmedItemId: item.id, progress: null, updatedAt: iso(now) }));
      await ctx.metric('match_confirmed', {
        category: item.category,
        dest: job.dest,
        retrieval: item.identity.retrieval,
        resolution: item.identity.resolution,
        variant: item.identity.variant,
        pick: picked ?? 'custom',
        candidateKind: candidate?.kind ?? null,
        candidateRank: candidate ? job.result.candidates.findIndex((c) => c.id === candidate.id) + 1 : null,
      });
      return { item: view, job: jobView(catalog, saved, now) };
    },
  },
};

/** Resolves a product URL through the commerce operation; tolerates it not being built. */
async function resolveLink(ctx, url) {
  try {
    const out = await ctx.call('importFromUrl', { url });
    if (out?.status === 'resolved' && out.productId) {
      return { status: 'resolved', productId: out.productId, variantId: out.variantId ?? null, offerId: out.offerId ?? null, reason: null };
    }
    if (out?.status === 'unsupported_link') return { status: 'unsupported_link', reason: 'That link is not from a store in the demo catalog, so it was not used.' };
    if (out?.status === 'invalid_url') return { status: 'invalid_url', reason: out.reason || 'That link could not be used. Check it and paste it again.' };
    return { status: 'unresolved', reason: 'That link could not be matched to the catalog.' };
  } catch (error) {
    if (error?.code === 'invalid') throw error;
    return { status: 'unavailable', reason: "Product links can't be checked right now, so the link was not used." };
  }
}
