// Display formatting. Unknown values render as words, never as zero.

const moneyFormats = new Map();

/**
 * @param {number|null|undefined} minor amount in minor units (cents)
 * @param {string} [currency]
 * @param {{ whole?: boolean }} [opts] whole: drop cents when they are zero
 */
export function money(minor, currency = 'USD', opts = {}) {
  if (minor == null || Number.isNaN(minor)) return 'Unknown';
  const whole = opts.whole !== false && minor % 100 === 0;
  const key = `${currency}:${whole}`;
  if (!moneyFormats.has(key)) {
    moneyFormats.set(
      key,
      new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        minimumFractionDigits: whole ? 0 : 2,
        maximumFractionDigits: whole ? 0 : 2,
      }),
    );
  }
  return moneyFormats.get(key).format(minor / 100);
}

/** Parses "$1,250.50" or "1250.5" into minor units; returns null when empty or invalid. */
export function parseMoney(text) {
  const cleaned = String(text ?? '').replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/** Minor units to a plain input value ("150" or "149.99"). */
export function moneyInput(minor) {
  if (minor == null) return '';
  return minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2);
}

const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const shortDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

export function date(iso) {
  if (!iso) return 'Unknown';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Unknown';
  return dateFormat.format(d);
}

export function dayMonth(iso) {
  if (!iso) return '';
  return shortDate.format(new Date(iso));
}

/** "3 hours ago", "2 days ago", "just now". */
export function relative(iso, now = Date.now()) {
  if (!iso) return 'unknown';
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return 'unknown';
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  return date(iso);
}

const SIZE_LABEL = {
  'US-M': 'US M',
  'US-W': 'US W',
  EU: 'EU',
  UK: 'UK',
  ALPHA: '',
  'WAIST-INSEAM': '',
  'ONE-SIZE': '',
};

/** {value:'10', system:'US-M'} -> "US M 10"; {value:'32x32', system:'WAIST-INSEAM'} -> "32 × 32". */
export function size(s) {
  if (!s || !s.value) return null;
  if (s.system === 'WAIST-INSEAM') return s.value.replace('x', ' × ');
  if (s.system === 'ONE-SIZE') return 'One size';
  const prefix = SIZE_LABEL[s.system] ?? s.system;
  return prefix ? `${prefix} ${s.value}` : s.value;
}

/** Splits a size for the label block: { top: 'US M', main: '10' }. */
export function sizeParts(s) {
  if (!s || !s.value) return null;
  if (s.system === 'WAIST-INSEAM') {
    const [w, l] = s.value.split('x');
    return { top: `W${w}`, main: l ? `L${l}` : w };
  }
  if (s.system === 'ONE-SIZE') return { top: 'Size', main: 'OS' };
  if (s.system === 'ALPHA') return { top: 'Size', main: s.value };
  return { top: SIZE_LABEL[s.system] ?? s.system, main: s.value };
}

export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function mm(value) {
  return value == null ? null : `${Number(value).toString()} mm`;
}

/** Joins words into "a, b and c". */
export function listJoin(items, conj = 'and') {
  const list = items.filter(Boolean);
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} ${conj} ${list[list.length - 1]}`;
}

export function capitalize(text) {
  const s = String(text ?? '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** 'like_new' -> 'Like new'. */
export function humanize(token) {
  return capitalize(String(token ?? '').replace(/[_-]+/g, ' '));
}

export function bytes(n) {
  if (n == null) return 'Unknown';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
