// The on-device photo pipeline in a phone-sized Chromium: sample photos are uploaded through the
// client the screens use, matched against reference renders of the catalog, confirmed, cleaned up
// and shown. Fails on wrong outcomes, console errors or failed requests.
// Usage: node tests/e2e/photo.mjs [--ocr]   (--ocr also reads a label photo with Tesseract.js,
// which downloads from jsDelivr, so it needs a connection)
import assert from 'node:assert/strict';
import { openApp } from './helpers.mjs';

const withOcr = process.argv.includes('--ocr');

// What each sample must produce: the product, and whether the photo alone settles the version.
const EXPECT = {
  'runner-navy': { productId: 'kestrel-runner-2', variantId: 'kestrel-runner-2--navy-white', settled: true },
  'runner-olive': { productId: 'kestrel-runner-2', settled: false, ask: 'style_code' },
  'court-white': { productId: 'vela-court-low', settled: false, ask: 'style_code' },
  'field-watch': { productId: 'arden-field', settled: false, ask: 'reference' },
  'field-jacket': { productId: 'harbor-pine-deck-jacket', variantId: 'harbor-pine-deck-jacket--olive', settled: true },
  'wool-trouser': { productId: 'fieldhouse-wool-trouser', variantId: 'fieldhouse-wool-trouser--charcoal', settled: true },
  'chore-jacket': { similarTo: ['wrenfield-chore-jacket', 'harbor-pine-deck-jacket'], ask: 'brand_label' },
  'red-runner': { productId: null },
};

const app = await openApp({ user: 'usr_demo_alex', route: '/collection' });
const { page, problems } = app;
try {
  const results = await page.evaluate(async () => {
    const client = await import('./js/client.js');
    const samples = await import('./js/engine/samples.js');
    const out = [];
    for (const sample of samples.listSamples()) {
      const blob = await samples.renderSample(sample.id);
      const upload = await client.api.uploadPhoto({ blob, kind: 'original' });
      let job = await client.api.createMatchJob({ photoId: upload.photoId, category: sample.category, dest: 'owned' });
      const started = performance.now();
      while (['queued', 'processing'].includes(job.status) && performance.now() - started < 30000) {
        await new Promise((r) => setTimeout(r, 100));
        job = await client.api.getMatchJob({ jobId: job.id });
      }
      out.push({ sample: sample.id, upload, job });
    }
    return out;
  });

  for (const { sample, upload, job } of results) {
    const want = EXPECT[sample];
    assert.ok(want, `an expectation for sample ${sample}`);
    assert.equal(upload.mime, 'image/jpeg', `${sample}: stored as a re-encoded JPEG`);
    assert.ok(Math.max(upload.width, upload.height) <= 2048, `${sample}: original capped at 2048 px`);
    assert.equal(job.status, 'done', `${sample}: ${job.error?.message ?? job.status}`);
    const lead = job.result.candidates[0];
    if (want.similarTo) {
      // Two products that look alike: neither becomes a match without more evidence.
      assert.equal(job.result.retrieval, 'similar_result', `${sample}: shown as similar, not a match`);
      assert.ok(job.result.candidates.every((c) => c.kind === 'similar'), `${sample}: only similar candidates`);
      for (const id of want.similarTo) assert.ok(job.result.candidates.some((c) => c.productId === id), `${sample}: ${id} is among them`);
      assert.ok(job.result.askFor.some((a) => a.kind === want.ask), `${sample}: asks for ${want.ask}`);
      continue;
    }
    if (!want.productId) {
      assert.notEqual(job.result.retrieval, 'candidate_found', `${sample}: abstains`);
      assert.ok(job.result.candidates.every((c) => c.kind === 'similar'), `${sample}: only lookalikes`);
      assert.equal(job.result.askFor[0].kind, 'product_link');
      continue;
    }
    assert.equal(job.result.retrieval, 'candidate_found', `${sample}: finds a candidate`);
    assert.equal(lead.productId, want.productId, `${sample}: right product`);
    assert.equal(lead.kind, 'match');
    if (want.settled) {
      assert.equal(lead.variantAmbiguous, false, `${sample}: the photo settles the version`);
      assert.equal(lead.variantId, want.variantId, `${sample}: right version`);
    } else {
      assert.equal(lead.variantAmbiguous, true, `${sample}: the version is left open`);
      assert.ok(job.result.askFor.some((a) => a.kind === want.ask), `${sample}: asks for ${want.ask}`);
    }
  }

  // Settle the watch with a typed reference, save it, clean up the photo and switch images.
  const flow = await page.evaluate(async (ocr) => {
    const client = await import('./js/client.js');
    const samples = await import('./js/engine/samples.js');
    const wait = async (id) => {
      let job;
      const started = performance.now();
      do {
        await new Promise((r) => setTimeout(r, 120));
        job = await client.api.getMatchJob({ jobId: id });
      } while (['queued', 'processing'].includes(job.status) && performance.now() - started < 60000);
      return job;
    };
    const upload = await client.api.uploadPhoto({ blob: await samples.renderSample('field-watch'), kind: 'original' });
    const created = await client.api.createMatchJob({ photoId: upload.photoId, category: 'watch', dest: 'owned' });
    await wait(created.id);
    if (ocr) {
      const label = await client.api.uploadPhoto({ blob: await samples.renderLabel({ variantId: 'arden-field--af40-sl-bk' }), kind: 'label' });
      await client.api.addMatchEvidence({ jobId: created.id, labelPhotoId: label.photoId });
    } else {
      await client.api.addMatchEvidence({ jobId: created.id, code: 'AF40-SL-BK' });
    }
    const job = await wait(created.id);
    const lead = job.result.candidates[0];
    const { item } = await client.api.confirmMatch({ jobId: job.id, candidateId: lead.id, variantId: lead.variantId, details: { condition: 'good' } });
    const cleaned = await client.api.cleanupPhoto({ itemId: item.id });
    const shown = await client.api.setDisplayImage({ itemId: item.id, display: 'cleaned' });
    const url = await client.api.getPhotoUrl({ photoId: cleaned.photoId });
    return { job, lead, item, cleaned, shown, url };
  }, withOcr);

  assert.equal(flow.lead.variantId, 'arden-field--af40-sl-bk', 'the reference settles 38 vs 40 mm');
  assert.equal(flow.lead.variantAmbiguous, false);
  const source = withOcr ? 'ocr' : 'user_entered';
  assert.ok(flow.lead.evidence.some((e) => e.kind === 'identifier' && e.source === source), `identifier evidence from ${source}`);
  assert.equal(flow.item.identity.resolution, 'identifier_supported');
  assert.equal(flow.item.image.kind, 'catalog', 'a confirmed version shows its catalog image');
  assert.ok(flow.item.photos.originalId, 'and keeps the original photo');
  assert.deepEqual(flow.shown.image.options, ['catalog', 'original', 'cleaned']);
  assert.equal(flow.shown.image.kind, 'cleaned');
  assert.equal(flow.shown.image.label, 'Your photo, cleaned up');
  assert.match(flow.url.url, /^blob:/);

  // The cleaned photo is a real, decodable image.
  const size = await page.evaluate(async (url) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { w: img.naturalWidth, h: img.naturalHeight };
  }, flow.url.url);
  assert.ok(size.w > 100 && size.h > 100, `cleaned photo decodes (${size.w}x${size.h})`);

  assert.deepEqual(problems, [], 'no console errors, page errors or failed requests');
  console.log(`Photo pipeline passed: ${results.length} samples matched as expected${withOcr ? ', label read on the device' : ''}.`);
} catch (error) {
  console.error(error);
  if (problems.length) console.error(problems.join('\n'));
  process.exitCode = 1;
} finally {
  await app.close();
}
