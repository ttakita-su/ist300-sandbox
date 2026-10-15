// Runs the synthetic matching evaluation (js/engine/eval.js) in headless Chromium and writes
// docs/evaluation.md. Usage: npm run eval [-- --seed 7 --count 39 --out 12]
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openApp } from './helpers.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};
const seed = arg('seed', 1);
const count = arg('count', 39);
const outOfCatalog = arg('out', 12);

const pct = (v) => (v == null ? 'n/a' : `${Math.round(v * 100)}%`);
const of = (v, n) => (v == null ? 'n/a' : `${Math.round(v * n)} of ${n} (${pct(v)})`);

const RETRIEVAL_WORDS = { similar_result: 'shown as similar', no_match: 'no match' };

function abstained(r) {
  const rows = r.photos.filter((p) => p.variantId && p.retrieval !== 'candidate_found');
  if (!rows.length) return 'Every in-catalog photo was matched.';
  return `In-catalog photos without a match claim:\n\n${rows.map((p) => `- \`${p.variantId}\`: ${RETRIEVAL_WORDS[p.retrieval] ?? p.retrieval}${p.leadProductId ? `, closest product \`${p.leadProductId}\`` : ', no item separated from the surface or nothing close'}`).join('\n')}`;
}

function markdown(r) {
  const rows = Object.entries(r.byCategory)
    .map(([c, m]) => `| ${c} | ${m.count} | ${of(m.top1, m.count)} | ${of(m.top3, m.count)} | ${of(m.exactVariant, m.count)} | ${of(m.variantAmbiguous, m.count)} | ${of(m.variantErrors, m.count)} | ${of(m.abstainedInCatalog, m.count)} |`)
    .join('\n');
  const n = r.counts.inCatalog;
  const o = r.outOfCatalog;
  return `# Matching evaluation (synthetic)

Generated ${r.generatedAt} by \`npm run eval\` (seed ${r.seed}). Catalog ${r.catalogVersion}, illustrations ${r.illustrationVersion}, matcher ${r.matcherVersion}.

**What this measures.** Every photo here is synthetic: a catalog illustration staged on a surface with light falloff, a color cast and noise, then put through the same steps as an upload (re-encode, processing copy, on-device features, matcher). It checks that the pipeline finds the right product, refuses to guess between versions a photo can't separate, and abstains on items the catalog doesn't have. It is not a measure of accuracy on real photos of real products, which would need the held-out photo set described in docs/PLAN.md (milestone 1).

## In-catalog photos (${n})

| Measure | Result |
| --- | --- |
| Right product as the match | ${of(r.overall.top1, n)} |
| Right product among the first three | ${of(r.overall.top3, n)} |
| Exact version settled by the photo alone | ${of(r.overall.exactVariant, n)} |
| Version left open, code asked for (versions that look alike) | ${of(r.overall.variantAmbiguous, n)} |
| Wrong version settled | ${of(r.overall.variantErrors, n)} |
| No match claimed (abstained) | ${of(r.overall.abstainedInCatalog, n)} |

| Category | Photos | Product | In top 3 | Exact version | Version left open | Wrong version | Abstained |
| --- | --- | --- | --- | --- | --- | --- | --- |
${rows}

${r.confusions.length ? `Wrong versions settled: ${r.confusions.map((c) => `${c.pair} (${c.count})`).join(', ')}.` : 'No wrong version was settled.'}

${abstained(r)}

## Items the catalog doesn't have (${o.count})

| Measure | Result |
| --- | --- |
| Abstained (no match claimed) | ${of(o.abstained, o.count)} |
| Shown only as similar products | ${of(o.similarShown, o.count)} |
| Wrongly claimed as a match | ${of(o.falseAccepts, o.count)} |

## Latency

Feature extraction and matching on the processing copy: p50 ${r.latencyMs.p50} ms, p95 ${r.latencyMs.p95} ms (headless Chromium on the machine that ran the evaluation).

## Notes

${r.notes.map((note) => `- ${note}`).join('\n')}
`;
}

const app = await openApp();
try {
  const report = await app.page.evaluate(
    async (opts) => {
      const { runEvaluation } = await import('./js/engine/eval.js');
      return runEvaluation(opts);
    },
    { seed, count, outOfCatalog },
  );
  if (app.problems.length) throw new Error(`Browser problems during the evaluation:\n${app.problems.join('\n')}`);
  const target = fileURLToPath(new URL('../../docs/evaluation.md', import.meta.url));
  await writeFile(target, markdown(report));
  console.log(`Wrote ${target}`);
  console.log(JSON.stringify({ overall: report.overall, outOfCatalog: report.outOfCatalog, latencyMs: report.latencyMs }));
} finally {
  await app.close();
}
