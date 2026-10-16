// Runs every browser check in order and fails if any fails. Usage: npm run test:e2e [-- --ocr]
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = (file) => fileURLToPath(new URL(file, import.meta.url));
const extra = process.argv.slice(2);
const CHECKS = [
  ['Every route as each role', here('./smoke.mjs'), []],
  ['Photo pipeline', here('./photo.mjs'), extra.filter((a) => a === '--ocr')],
  ['Real product lookups (fixture stores, no network)', here('./web.mjs'), []],
];

let failed = 0;
for (const [name, file, args] of CHECKS) {
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [file, ...args], { stdio: 'inherit' });
    child.on('exit', (c) => resolve(c ?? 1));
  });
  console.log(`${code === 0 ? 'pass' : 'FAIL'}  ${name}`);
  if (code !== 0) failed += 1;
}
if (failed) {
  console.error(`${failed} browser check(s) failed.`);
  process.exit(1);
}
