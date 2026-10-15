// Outbound links to retailers. Only approved affiliate programs get tracking, and only with the
// parameters the program allows. The link always goes to the retailer's own domain, so an
// offer record can never turn the redirect into an open redirect. See docs/affiliate.md.
import { ApiError } from '../server/errors.js';
import { newId } from '../lib/ids.js';

/** Parameter names networks use for a publisher's own click or sub id. */
export const SUB_ID_PARAMS = ['sub_id', 'subid', 'sub1', 'u1', 'sid', 'clickref', 'click_ref', 'click_id', 'clickid'];

const CLICK_REF = /^c_[a-z0-9]{8,64}$/;
const PARAM_NAME = /^[A-Za-z0-9_.-]{1,40}$/;
const BLOCKED = "This listing's link doesn't go to the retailer's own site, so Rotation won't open it.";

/** Random, pseudonymous reference for one outbound click ('c_' + 16 base-36 characters). */
export function newClickRef() {
  return newId('c');
}

function decodeName(pair) {
  const name = pair.split('=')[0];
  try {
    return decodeURIComponent(name.replace(/\+/g, ' '));
  } catch {
    return name;
  }
}

/** The listing's own query, untouched except for the named parameters, plus the new ones. */
function withParams(url, remove, add) {
  const kept = url.search
    .replace(/^\?/, '')
    .split('&')
    .filter((pair) => pair && !remove.has(decodeName(pair)));
  for (const [name, value] of add) kept.push(`${encodeURIComponent(name)}=${encodeURIComponent(value)}`);
  url.search = kept.length ? `?${kept.join('&')}` : '';
  return url;
}

/**
 * Builds the outbound URL for an offer.
 * - approved program: adds only `allowedParams` that have a value in `paramValues`; the click
 *   reference goes into a sub-id style parameter only when the program allows one.
 * - pending or no program: the plain listing URL (any of the program's parameters removed).
 * - the destination host must be the retailer's domain (or its www. host), over http(s), with
 *   no credentials or custom port; anything else throws ApiError('invalid').
 * @param {{ offer: any, retailer: any, clickRef?: string|null }} input
 * @returns {{ url: string, tracked: boolean, network: string|null }}
 */
export function buildOutboundUrl({ offer, retailer, clickRef = null }) {
  if (!offer || !retailer || (offer.retailerId && offer.retailerId !== retailer.id)) {
    throw new ApiError('invalid', BLOCKED);
  }
  let url;
  try {
    url = new URL(String(offer.url ?? ''));
  } catch {
    throw new ApiError('invalid', "This listing doesn't have a working link.");
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  const domain = String(retailer.domain ?? '').toLowerCase().replace(/\.$/, '');
  const ownSite = domain && (host === domain || host === `www.${domain}`);
  if (!['https:', 'http:'].includes(url.protocol) || !ownSite || url.username || url.password || url.port) {
    throw new ApiError('invalid', BLOCKED);
  }

  const program = retailer.affiliate ?? null;
  const programParams = new Set([...(program?.allowedParams ?? []), ...Object.keys(program?.paramValues ?? {})]);
  if (program?.status !== 'approved') {
    // Tracking without an approved program would claim a relationship that doesn't exist.
    return { url: withParams(url, programParams, []).href, tracked: false, network: null };
  }

  const add = [];
  for (const name of program.allowedParams ?? []) {
    if (!PARAM_NAME.test(name)) continue;
    const value = program.paramValues?.[name];
    if (value != null && value !== '') add.push([name, String(value)]);
  }
  const subId = (program.allowedParams ?? []).find(
    (name) => PARAM_NAME.test(name) && SUB_ID_PARAMS.includes(name.toLowerCase()) && (program.paramValues?.[name] ?? '') === '',
  );
  if (subId && typeof clickRef === 'string' && CLICK_REF.test(clickRef)) add.push([subId, clickRef]);

  const tracked = add.length > 0;
  return { url: withParams(url, programParams, add).href, tracked, network: tracked ? program.networkId ?? null : null };
}
